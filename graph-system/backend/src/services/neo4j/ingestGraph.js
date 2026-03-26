const fs = require("fs");
const path = require("path");

const { DATA_ROOT } = require("../../config");
const { readJsonlFile } = require("../../utils/jsonl");
const { sanitizePropsObject, normalizeItemId } = require("../../utils/neo4jProps");
const { getDriver } = require("./driver");

const DEFAULT_STEPS = [
  "addresses",
  "customers",
  "products",
  "plants",
  "salesOrders",
  "salesOrderItems",
  "deliveries",
  "deliveryItems",
  "billingDocuments",
  "billingItems",
  "journalEntries",
  "payments",
];

function listJsonlFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith(".jsonl"))
    .map((f) => path.join(dirPath, f))
    .sort();
}

async function clearDb(session) {
  await session.run("MATCH (n) DETACH DELETE n");
}

async function ensureConstraints(session) {
  // Constraints speed up MERGE on id-based nodes and ensure data consistency.
  // Neo4j 5 supports IF NOT EXISTS.
  const constraints = [
    "SalesOrder",
    "SalesOrderItem",
    "Delivery",
    "DeliveryItem",
    "BillingDocument",
    "BillingItem",
    "JournalEntry",
    "Payment",
    "Customer",
    "Product",
    "Plant",
    "Address",
  ];

  for (const label of constraints) {
    // eslint-disable-next-line no-await-in-loop
    await session.run(`CREATE CONSTRAINT IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`);
  }
}

async function ingestAddresses(session) {
  const dir = path.join(DATA_ROOT, "business_partner_addresses");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (a:Address {id: row.id})
    SET a += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.addressId ? String(row.addressId) : "";
      if (!id) return;
      batch.push({
        id,
        props: sanitizePropsObject({
          addressUuid: row.addressUuid,
          cityName: row.cityName,
          country: row.country,
          region: row.region,
          streetName: row.streetName,
          postalCode: row.postalCode,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }

  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestCustomers(session) {
  const dir = path.join(DATA_ROOT, "business_partners");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (c:Customer {id: row.id})
    SET c += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.customer ? String(row.customer) : String(row.businessPartner || "");
      if (!id) return;
      batch.push({
        id,
        props: sanitizePropsObject({
          businessPartner: row.businessPartner,
          name: row.businessPartnerFullName || row.businessPartnerName,
          grouping: row.businessPartnerGrouping,
          category: row.businessPartnerCategory,
          isBlocked: row.businessPartnerIsBlocked,
          isMarkedForArchiving: row.isMarkedForArchiving,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }

  if (batch.length) await session.run(cypher, { rows: batch });

  // Link customers to addresses (optional but makes UI richer).
  const addrDir = path.join(DATA_ROOT, "business_partner_addresses");
  const addrFiles = listJsonlFiles(addrDir);
  let linkBatch = [];
  let linkedCount = 0;
  const linkCypher = `
    UNWIND $rows AS row
    MATCH (c:Customer {id: row.customerId})
    MATCH (a:Address {id: row.addressId})
    MERGE (c)-[:HAS_ADDRESS]->(a)
  `;
  for (const file of addrFiles) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const customerId = row.businessPartner ? String(row.businessPartner) : "";
      const addressId = row.addressId ? String(row.addressId) : "";
      if (!customerId || !addressId) return;
      linkBatch.push({ customerId, addressId });
      linkedCount += 1;
      if (linkBatch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(linkCypher, { rows: linkBatch });
        linkBatch = [];
      }
    });
  }
  if (linkBatch.length) await session.run(linkCypher, { rows: linkBatch });

  return { customers: count, customerAddressLinks: linkedCount };
}

async function ingestProducts(session) {
  const dir = path.join(DATA_ROOT, "products");
  const descDir = path.join(DATA_ROOT, "product_descriptions");
  const descFiles = listJsonlFiles(descDir);

  // Map: productId -> english description (if present).
  const productDescriptions = new Map();
  for (const file of descFiles) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      if (row.language !== "EN") return;
      if (!row.product) return;
      if (!row.productDescription) return;
      // Keep first EN description we see.
      if (!productDescriptions.has(String(row.product))) productDescriptions.set(String(row.product), String(row.productDescription));
    });
  }

  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (p:Product {id: row.id})
    SET p += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.product ? String(row.product) : "";
      if (!id) return;
      const props = {
        productType: row.productType,
        productGroup: row.productGroup,
        baseUnit: row.baseUnit,
        division: row.division,
        industrySector: row.industrySector,
        grossWeight: row.grossWeight,
        weightUnit: row.weightUnit,
        netWeight: row.netWeight,
        productDescription: productDescriptions.get(id) || "",
      };
      batch.push({ id, props: sanitizePropsObject(props) });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }

  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestPlants(session) {
  const dir = path.join(DATA_ROOT, "plants");
  const files = listJsonlFiles(dir);
  const batchSize = 200;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (pl:Plant {id: row.id})
    SET pl += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.plant ? String(row.plant) : "";
      if (!id) return;
      batch.push({
        id,
        props: sanitizePropsObject({
          plantName: row.plantName,
          valuationArea: row.valuationArea,
          factoryCalendar: row.factoryCalendar,
          salesOrganization: row.salesOrganization,
          distributionChannel: row.distributionChannel,
          division: row.division,
          addressId: row.addressId ? String(row.addressId) : "",
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });

  // Plant -> Address (if we can match by addressId).
  const linkCypher = `
    MATCH (pl:Plant)
    MATCH (a:Address {id: pl.addressId})
    MERGE (pl)-[:HAS_ADDRESS]->(a)
    REMOVE pl.addressId
  `;
  try {
    await session.run(linkCypher);
  } catch (_e) {
    // Ignore address linking failures.
  }

  return count;
}

async function ingestSalesOrders(session) {
  const dir = path.join(DATA_ROOT, "sales_order_headers");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (so:SalesOrder {id: row.id})
    SET so += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.salesOrder ? String(row.salesOrder) : "";
      if (!id) return;
      const soldTo = row.soldToParty ? String(row.soldToParty) : "";
      batch.push({
        id,
        props: sanitizePropsObject({
          salesOrderType: row.salesOrderType,
          salesOrganization: row.salesOrganization,
          distributionChannel: row.distributionChannel,
          organizationDivision: row.organizationDivision,
          soldToParty: soldTo,
          totalNetAmount: row.totalNetAmount,
          transactionCurrency: row.transactionCurrency,
          overallDeliveryStatus: row.overallDeliveryStatus,
          requestedDeliveryDate: row.requestedDeliveryDate,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });

  // Customer -> SalesOrder
  const linkCypher = `
    MATCH (so:SalesOrder)
    MATCH (c:Customer {id: so.soldToParty})
    MERGE (c)-[:PLACED]->(so)
  `;
  await session.run(linkCypher);
  return count;
}

async function ingestSalesOrderItems(session) {
  const dir = path.join(DATA_ROOT, "sales_order_items");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;
  const salesOrderItemToProductId = new Map(); // SalesOrderId:ItemNorm -> ProductId(material)

  const cypher = `
    UNWIND $rows AS row
    MERGE (so:SalesOrder {id: row.salesOrderId})
    MERGE (soi:SalesOrderItem {id: row.salesOrderItemId})
    SET soi += row.itemProps
    MERGE (so)-[:HAS_ITEM]->(soi)
    MERGE (p:Product {id: row.productId})
    MERGE (p)-[:REFERENCED_IN]->(soi)
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const salesOrderId = row.salesOrder ? String(row.salesOrder) : "";
      const itemNorm = normalizeItemId(row.salesOrderItem);
      const salesOrderItemId = `${salesOrderId}:${itemNorm}`;
      const productId = row.material ? String(row.material) : "";
      if (!salesOrderId || !itemNorm || !productId) return;

      batch.push({
        salesOrderId,
        salesOrderItemId,
        productId,
        itemProps: sanitizePropsObject({
          salesOrderItemCategory: row.salesOrderItemCategory,
          material: row.material,
          materialGroup: row.materialGroup,
          requestedQuantity: row.requestedQuantity,
          requestedQuantityUnit: row.requestedQuantityUnit,
          netAmount: row.netAmount,
          transactionCurrency: row.transactionCurrency,
          productionPlant: row.productionPlant ? String(row.productionPlant) : "",
          storageLocation: row.storageLocation ? String(row.storageLocation) : "",
        }),
      });
      salesOrderItemToProductId.set(salesOrderItemId, productId);
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });
  return { count, salesOrderItemToProductId };
}

async function ingestDeliveries(session) {
  const dir = path.join(DATA_ROOT, "outbound_delivery_headers");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (d:Delivery {id: row.id})
    SET d += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.deliveryDocument ? String(row.deliveryDocument) : "";
      if (!id) return;
      batch.push({
        id,
        props: sanitizePropsObject({
          shippingPoint: row.shippingPoint,
          overallGoodsMovementStatus: row.overallGoodsMovementStatus,
          overallPickingStatus: row.overallPickingStatus,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestDeliveryItems(session, salesOrderItemToProductId) {
  const dir = path.join(DATA_ROOT, "outbound_delivery_items");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (d:Delivery {id: row.deliveryId})
    MERGE (di:DeliveryItem {id: row.deliveryItemId})
    SET di += row.itemProps
    MERGE (d)-[:HAS_ITEM]->(di)
    MERGE (pl:Plant {id: row.plantId})
    MERGE (d)-[:HAS_PLANT]->(pl)

    // Connect the originating SalesOrderItem to this DeliveryItem.
    MERGE (soi:SalesOrderItem {id: row.salesOrderItemId})
    MERGE (soi)-[:DELIVERED_IN]->(di)

    // Product <- REFERENCED_IN - DeliveryItem (derived via SalesOrderItem -> material).
    MERGE (p:Product {id: row.productId})
    MERGE (p)-[:REFERENCED_IN]->(di)

    // Connect Delivery -> SalesOrder (for document-level flow tracing).
    MERGE (so:SalesOrder {id: row.salesOrderId})
    MERGE (d)-[:LINKED_TO]->(so)
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const deliveryId = row.deliveryDocument ? String(row.deliveryDocument) : "";
      const deliveryItemNorm = normalizeItemId(row.deliveryDocumentItem);
      const deliveryItemId = `${deliveryId}:${deliveryItemNorm}`;
      const plantId = row.plant ? String(row.plant) : "";

      // referenceSdDocument* is the originating Sales Order.
      const salesOrderId = row.referenceSdDocument ? String(row.referenceSdDocument) : "";
      const salesOrderItemNorm = normalizeItemId(row.referenceSdDocumentItem);
      const salesOrderItemId = `${salesOrderId}:${salesOrderItemNorm}`;

      if (!deliveryId || !deliveryItemNorm || !plantId || !salesOrderId || !salesOrderItemNorm) return;

      const productId = salesOrderItemToProductId.get(salesOrderItemId) || "";
      if (!productId) return;

      batch.push({
        deliveryId,
        deliveryItemId,
        plantId,
        salesOrderId,
        salesOrderItemId,
        productId,
        itemProps: sanitizePropsObject({
          actualDeliveryQuantity: row.actualDeliveryQuantity,
          deliveryQuantityUnit: row.deliveryQuantityUnit,
          batch: row.batch || "",
          storageLocation: row.storageLocation ? String(row.storageLocation) : "",
          plant: row.plant,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestBillingDocuments(session) {
  const dir = path.join(DATA_ROOT, "billing_document_headers");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (bd:BillingDocument {id: row.id})
    SET bd += row.props
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const id = row.billingDocument ? String(row.billingDocument) : "";
      if (!id) return;
      const soldTo = row.soldToParty ? String(row.soldToParty) : "";
      batch.push({
        id,
        props: sanitizePropsObject({
          billingDocumentType: row.billingDocumentType,
          billingDocumentDate: row.billingDocumentDate,
          billingDocumentIsCancelled: row.billingDocumentIsCancelled,
          cancelledBillingDocument: row.cancelledBillingDocument,
          totalNetAmount: row.totalNetAmount,
          transactionCurrency: row.transactionCurrency,
          companyCode: row.companyCode,
          fiscalYear: row.fiscalYear,
          accountingDocument: row.accountingDocument,
          soldToParty: soldTo,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });

  const linkCypher = `
    MATCH (bd:BillingDocument)
    MATCH (c:Customer {id: bd.soldToParty})
    MERGE (c)-[:BILLS_FOR]->(bd)
  `;
  try {
    await session.run(linkCypher);
  } catch (_e) {
    // Ignore.
  }

  return count;
}

async function ingestBillingItems(session) {
  const dir = path.join(DATA_ROOT, "billing_document_items");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (bd:BillingDocument {id: row.billingDocumentId})
    MERGE (bi:BillingItem {id: row.billingItemId})
    SET bi += row.itemProps
    MERGE (bd)-[:HAS_ITEM]->(bi)

    // BillingItem -> Product
    MERGE (p:Product {id: row.productId})
    MERGE (p)-[:REFERENCED_IN]->(bi)

    // BillingDocument -> Delivery (document-level flow tracing)
    MERGE (d:Delivery {id: row.deliveryId})
    MERGE (bd)-[:GENERATED_FROM]->(d)
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const billingDocumentId = row.billingDocument ? String(row.billingDocument) : "";
      const itemNorm = normalizeItemId(row.billingDocumentItem);
      const billingItemId = `${billingDocumentId}:${itemNorm}`;
      const productId = row.material ? String(row.material) : "";

      // referenceSdDocument is the originating delivery document in this dataset.
      const deliveryId = row.referenceSdDocument ? String(row.referenceSdDocument) : "";

      if (!billingDocumentId || !itemNorm || !productId || !deliveryId) return;

      batch.push({
        billingDocumentId,
        billingItemId,
        productId,
        deliveryId,
        itemProps: sanitizePropsObject({
          material: row.material,
          billingQuantity: row.billingQuantity,
          billingQuantityUnit: row.billingQuantityUnit,
          netAmount: row.netAmount,
          transactionCurrency: row.transactionCurrency,
          referenceSdDocument: row.referenceSdDocument,
          referenceSdDocumentItem: row.referenceSdDocumentItem,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }
  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestJournalEntries(session) {
  const dir = path.join(DATA_ROOT, "journal_entry_items_accounts_receivable");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (bd:BillingDocument {id: row.billingDocumentId})
    MERGE (je:JournalEntry {id: row.journalEntryId})
    SET je += row.jeProps
    MERGE (bd)-[:POSTED_TO]->(je)
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const billingDocumentId = row.referenceDocument ? String(row.referenceDocument) : "";
      const journalEntryId = row.accountingDocument ? String(row.accountingDocument) : "";
      if (!billingDocumentId || !journalEntryId) return;

      batch.push({
        billingDocumentId,
        journalEntryId,
        jeProps: sanitizePropsObject({
          companyCode: row.companyCode,
          fiscalYear: row.fiscalYear,
          accountingDocumentType: row.accountingDocumentType,
          accountingDocumentItem: row.accountingDocumentItem,
          glAccount: row.glAccount,
          profitCenter: row.profitCenter,
          costCenter: row.costCenter,
          customer: row.customer,
          transactionCurrency: row.transactionCurrency,
          amountInTransactionCurrency: row.amountInTransactionCurrency,
          postingDate: row.postingDate,
          documentDate: row.documentDate,
          clearingDate: row.clearingDate,
          clearingAccountingDocument: row.clearingAccountingDocument,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }

  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestPayments(session) {
  const dir = path.join(DATA_ROOT, "payments_accounts_receivable");
  const files = listJsonlFiles(dir);
  const batchSize = 500;
  let batch = [];
  let count = 0;

  const cypher = `
    UNWIND $rows AS row
    MERGE (je:JournalEntry {id: row.journalEntryId})
    MERGE (p:Payment {id: row.paymentId})
    SET p += row.paymentProps
    MERGE (je)-[:CLEARED_BY]->(p)
  `;

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonlFile(file, async (row) => {
      const journalEntryId = row.accountingDocument ? String(row.accountingDocument) : "";
      const paymentId = row.clearingAccountingDocument ? String(row.clearingAccountingDocument) : "";
      if (!journalEntryId || !paymentId) return;

      batch.push({
        journalEntryId,
        paymentId,
        paymentProps: sanitizePropsObject({
          companyCode: row.companyCode,
          fiscalYear: row.fiscalYear,
          customer: row.customer,
          transactionCurrency: row.transactionCurrency,
          amountInTransactionCurrency: row.amountInTransactionCurrency,
          postingDate: row.postingDate,
          documentDate: row.documentDate,
          clearingDate: row.clearingDate,
          clearingDocFiscalYear: row.clearingDocFiscalYear,
        }),
      });
      count += 1;
      if (batch.length >= batchSize) {
        // eslint-disable-next-line no-await-in-loop
        await session.run(cypher, { rows: batch });
        batch = [];
      }
    });
  }

  if (batch.length) await session.run(cypher, { rows: batch });
  return count;
}

async function ingestGraph({ reset = true, entities, onStep } = {}) {
  const driver = getDriver();
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    if (reset) await clearDb(session);

    await ensureConstraints(session);

    const stepList = Array.isArray(entities) && entities.length ? entities : DEFAULT_STEPS;

    const stats = {};
    const runStep = async (stepName, fn) => {
      if (onStep) onStep({ event: "start", step: stepName });
      const result = await fn();
      if (onStep) onStep({ event: "done", step: stepName, result });
      return result;
    };

    // Some steps depend on outputs of earlier steps.
    let soItemIndex;

    for (const step of stepList) {
      // eslint-disable-next-line default-case
      switch (step) {
        case "addresses":
          stats.addresses = await runStep("addresses", () => ingestAddresses(session));
          break;
        case "customers": {
          const r = await runStep("customers", () => ingestCustomers(session));
          stats.customers = r?.customers ?? r;
          break;
        }
        case "products":
          stats.products = await runStep("products", () => ingestProducts(session));
          break;
        case "plants":
          stats.plants = await runStep("plants", () => ingestPlants(session));
          break;
        case "salesOrders":
          stats.salesOrders = await runStep("salesOrders", () => ingestSalesOrders(session));
          break;
        case "salesOrderItems":
          soItemIndex = await runStep("salesOrderItems", () => ingestSalesOrderItems(session));
          stats.salesOrderItems = soItemIndex.count;
          break;
        case "deliveries":
          stats.deliveries = await runStep("deliveries", () => ingestDeliveries(session));
          break;
        case "deliveryItems":
          if (!soItemIndex?.salesOrderItemToProductId) {
            throw new Error("deliveryItems requires salesOrderItems to run first");
          }
          stats.deliveryItems = await runStep("deliveryItems", () =>
            ingestDeliveryItems(session, soItemIndex.salesOrderItemToProductId),
          );
          break;
        case "billingDocuments":
          stats.billingDocuments = await runStep("billingDocuments", () => ingestBillingDocuments(session));
          break;
        case "billingItems":
          stats.billingItems = await runStep("billingItems", () => ingestBillingItems(session));
          break;
        case "journalEntries":
          stats.journalEntries = await runStep("journalEntries", () => ingestJournalEntries(session));
          break;
        case "payments":
          stats.payments = await runStep("payments", () => ingestPayments(session));
          break;
        default:
          throw new Error(`Unknown ingest step: ${step}`);
      }
    }

    return stats;
  } finally {
    await session.close();
  }
}

module.exports = { ingestGraph };


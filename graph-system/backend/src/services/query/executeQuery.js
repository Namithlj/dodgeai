const neo4j = require("neo4j-driver");
const { getDriver } = require("../neo4j/driver");

function buildNaturalLanguageReponse(intent, rawResult) {
  if (intent === "top_products_by_billing") {
    const rows = rawResult.rows || [];
    const top = rows.map(
      (r) =>
        `${r.description ? `${r.description} (${r.productId})` : r.productId}: ${r.billingDocumentCount} billing documents`
    );
    if (!top.length) return "No billing data found for products in this dataset.";
    return `Top products by billing document count:\n${top.join("\n")}`;
  }

  if (intent === "trace_billing_document") {
    const r = rawResult;
    const sales = r.salesOrders?.length
      ? r.salesOrders.map(
          (s) => `${s.salesOrderId}${s.customerName ? ` (Customer: ${s.customerName})` : ""}`
        )
      : [];
    const deliveries = r.deliveries?.length
      ? r.deliveries.map(
          (d) => `${d.deliveryId}${d.shippingPoint ? ` (ShippingPoint: ${d.shippingPoint})` : ""}`
        )
      : [];
    const journal = r.journalEntries?.length
      ? r.journalEntries.map(
          (je) => `${je.journalEntryId} (Amount: ${je.amountInTransactionCurrency || "?"})`
        )
      : [];
    const payments = r.payments?.length
      ? r.payments.map(
          (p) => `${p.paymentId}${p.clearingDate ? ` (Cleared: ${p.clearingDate})` : ""}`
        )
      : [];

    return [
      `Flow trace for billing document ${r.billingDocumentId}:`,
      sales.length ? `SalesOrders: ${sales.join(", ")}` : `SalesOrders: none found`,
      deliveries.length ? `Deliveries: ${deliveries.join(", ")}` : `Deliveries: none found`,
      journal.length ? `JournalEntries: ${journal.join(", ")}` : `JournalEntries: none found`,
      payments.length ? `Payments: ${payments.join(", ")}` : `Payments: none found`,
    ].join("\n");
  }

  if (intent === "find_broken_flows") {
    const delivered = rawResult.deliveredButNotBilled || [];
    const billed = rawResult.billedButNotDelivered || [];

    return [
      `Broken flow summary:`,
      delivered.length
        ? `Delivered but not billed: ${delivered
            .map((x) => `${x.salesOrderId} (deliveries: ${x.deliveryCount})`)
            .join(", ")}`
        : `Delivered but not billed: none found`,
      billed.length
        ? `Billed but not delivered: ${billed
            .map((x) => `${x.salesOrderId} (billings: ${x.billingCount})`)
            .join(", ")}`
        : `Billed but not delivered: none found`,
    ].join("\n");
  }

  return "Unable to answer the request using the dataset graph.";
}

async function executeStructuredQuery(structuredQuery) {
  const driver = getDriver();
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const intent = structuredQuery.intent;
    const params = structuredQuery.params || {};

    // ✅ FIXED QUERY
    if (intent === "top_products_by_billing") {
      const topK = Math.max(1, Math.min(50, Math.floor(Number(params.topK || 5))));

      const cypher = `
        MATCH (bd:BillingDocument)-[:HAS_ITEM]->(bi:BillingItem)-[:REFERENCED_IN]->(p:Product)
        RETURN
          p.id AS productId,
          p.productDescription AS description,
          count(DISTINCT bd) AS billingDocumentCount
        ORDER BY billingDocumentCount DESC
        LIMIT $topK
      `;

      const res = await session.run(cypher, { topK: neo4j.int(topK) });

      if (!res.records.length) {
        return {
          rows: [],
          intent,
          answer: "No billing data found for products in this dataset.",
        };
      }

      const rows = res.records.map((rec) => ({
        productId: rec.get("productId"),
        description: rec.get("description") || "",
        billingDocumentCount: rec.get("billingDocumentCount")?.toNumber
          ? rec.get("billingDocumentCount").toNumber()
          : rec.get("billingDocumentCount"),
      }));

      return {
        rows,
        intent,
        answer: buildNaturalLanguageReponse(intent, { rows }),
      };
    }

    // ✅ TRACE BILLING
    if (intent === "trace_billing_document") {
      const billingDocumentId = String(params.billingDocumentId || "");
      if (!billingDocumentId) throw new Error("Missing billingDocumentId");

      const cypher = `
        MATCH (bd:BillingDocument {id: $billingDocumentId})
        OPTIONAL MATCH (bd)-[:GENERATED_FROM]->(d:Delivery)
        OPTIONAL MATCH (d)-[:LINKED_TO]->(so:SalesOrder)
        OPTIONAL MATCH (so)-[:PLACED]->(c:Customer)
        OPTIONAL MATCH (bd)-[:POSTED_TO]->(je:JournalEntry)
        OPTIONAL MATCH (je)-[:CLEARED_BY]->(pay:Payment)
        RETURN
          bd.id AS billingDocumentId,
          collect(DISTINCT {deliveryId: d.id, shippingPoint: d.shippingPoint}) AS deliveries,
          collect(DISTINCT {salesOrderId: so.id, customerName: c.name}) AS salesOrders,
          collect(DISTINCT {journalEntryId: je.id, amountInTransactionCurrency: je.amountInTransactionCurrency}) AS journalEntries,
          collect(DISTINCT {paymentId: pay.id, clearingDate: pay.clearingDate}) AS payments
      `;

      const res = await session.run(cypher, { billingDocumentId });
      const record = res.records[0];

      if (!record) {
        return {
          intent,
          answer: "No data found for this billing document.",
        };
      }

      const raw = {
        billingDocumentId,
        deliveries: (record.get("deliveries") || []).filter((x) => x.deliveryId),
        salesOrders: (record.get("salesOrders") || []).filter((x) => x.salesOrderId),
        journalEntries: (record.get("journalEntries") || []).filter((x) => x.journalEntryId),
        payments: (record.get("payments") || []).filter((x) => x.paymentId),
      };

      return { ...raw, intent, answer: buildNaturalLanguageReponse(intent, raw) };
    }

    // ✅ BROKEN FLOWS
    if (intent === "find_broken_flows") {
      const limit = Math.max(1, Math.min(100, Math.floor(Number(params.limit || 20))));

      const deliveredRes = await session.run(
        `
        MATCH (so:SalesOrder)
        OPTIONAL MATCH (d:Delivery)-[:LINKED_TO]->(so)
        WITH so, count(DISTINCT d) AS deliveryCount
        OPTIONAL MATCH (bd:BillingDocument)-[:GENERATED_FROM]->(d2:Delivery)
        WHERE (d2)-[:LINKED_TO]->(so)
        WITH so, deliveryCount, count(DISTINCT bd) AS billingCount
        WHERE deliveryCount > 0 AND billingCount = 0
        RETURN so.id AS salesOrderId, deliveryCount, billingCount
        LIMIT $limit
      `,
        { limit: neo4j.int(limit) }
      );

      const billedRes = await session.run(
        `
        MATCH (so:SalesOrder)
        OPTIONAL MATCH (d:Delivery)-[:LINKED_TO]->(so)
        WITH so, count(DISTINCT d) AS deliveryCount
        OPTIONAL MATCH (bd:BillingDocument)-[:GENERATED_FROM]->(d2:Delivery)
        WHERE (d2)-[:LINKED_TO]->(so)
        WITH so, deliveryCount, count(DISTINCT bd) AS billingCount
        WHERE billingCount > 0 AND deliveryCount = 0
        RETURN so.id AS salesOrderId, deliveryCount, billingCount
        LIMIT $limit
      `,
        { limit: neo4j.int(limit) }
      );

      const deliveredButNotBilled = deliveredRes.records.map((rec) => ({
        salesOrderId: rec.get("salesOrderId"),
        deliveryCount: rec.get("deliveryCount")?.toNumber?.() ?? rec.get("deliveryCount"),
        billingCount: rec.get("billingCount")?.toNumber?.() ?? rec.get("billingCount"),
      }));

      const billedButNotDelivered = billedRes.records.map((rec) => ({
        salesOrderId: rec.get("salesOrderId"),
        deliveryCount: rec.get("deliveryCount")?.toNumber?.() ?? rec.get("deliveryCount"),
        billingCount: rec.get("billingCount")?.toNumber?.() ?? rec.get("billingCount"),
      }));

      const raw = { deliveredButNotBilled, billedButNotDelivered };

      return {
        intent,
        ...raw,
        answer: buildNaturalLanguageReponse(intent, raw),
      };
    }

    return { intent, answer: "Unsupported intent." };
  } finally {
    await session.close();
  }
}

module.exports = { executeStructuredQuery };
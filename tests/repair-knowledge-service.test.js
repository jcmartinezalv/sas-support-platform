import test from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeBaseStore } from "../src/knowledge/knowledge-base-store.js";
import { createRepairKnowledgeService } from "../src/repairs/repair-knowledge-service.js";

function createOutcomeStore(summary) {
  return { summary: () => summary };
}

test("repair knowledge service creates pending proposal from confirmed outcomes", () => {
  const knowledgeBaseStore = createKnowledgeBaseStore({ initialArticles: [] });
  const auditEvents = [];
  const service = createRepairKnowledgeService({
    knowledgeBaseStore,
    repairOutcomeStore: createOutcomeStore([
      { actionId: "flush_dns", actionTitle: "Limpiar cache DNS", confirmedResolved: 2, confirmedUnresolved: 0, resolutionRate: 1 }
    ]),
    auditStore: { record: (event) => auditEvents.push(event) }
  });

  const result = service.createPendingArticles({ actor: { id: "tech-1", role: "supervisor" } });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].status, "pending_review");
  assert.equal(result.articles[0].repairActionId, "flush_dns");
  assert.equal(auditEvents[0].action, "repair.knowledge_proposal");
});

test("repair knowledge service skips low confidence and duplicate proposals", () => {
  const knowledgeBaseStore = createKnowledgeBaseStore({ initialArticles: [] });
  knowledgeBaseStore.create({
    title: "Reparacion confirmada: Limpiar cache DNS",
    category: "network",
    repairActionId: "flush_dns",
    status: "pending_review",
    resolutionSteps: ["Paso existente"]
  }, "test");
  const service = createRepairKnowledgeService({
    knowledgeBaseStore,
    repairOutcomeStore: createOutcomeStore([
      { actionId: "flush_dns", actionTitle: "Limpiar cache DNS", confirmedResolved: 5, confirmedUnresolved: 0, resolutionRate: 1 },
      { actionId: "renew_ip", actionTitle: "Renovar IP", confirmedResolved: 1, confirmedUnresolved: 0, resolutionRate: 1 }
    ])
  });

  const proposals = service.buildProposals();

  assert.equal(proposals.length, 0);
});

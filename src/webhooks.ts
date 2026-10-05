// Generated from generated/api/resources/webhooks/types.
import type * as Webhooks from "./generated/api/resources/webhooks/types/index.js";

/**
 * Every webhook body Alguna sends: `{ type, timestamp, data }`. Narrow on `type`
 * for a typed `data`, and handle types added after this release in a `default` branch.
 */
export type AlgunaWebhookEvent =
  | Webhooks.WebhookAccountCreditsBalanceDepletedPayload
  | Webhooks.WebhookAccountCreditsGrantedPayload
  | Webhooks.WebhookApprovalFlowCompletedPayload
  | Webhooks.WebhookApprovalRequestApprovedPayload
  | Webhooks.WebhookApprovalRequestCreatedPayload
  | Webhooks.WebhookApprovalRequestRejectedPayload
  | Webhooks.WebhookCheckoutSessionCompletedPayload
  | Webhooks.WebhookInvoiceIssuedPayload
  | Webhooks.WebhookInvoiceOverduePayload
  | Webhooks.WebhookInvoicePaidPayload
  | Webhooks.WebhookLineitemDeletedPayload
  | Webhooks.WebhookPaymentCreatedPayload
  | Webhooks.WebhookPaymentUpdatedPayload
  | Webhooks.WebhookRefundUpdatedPayload
  | Webhooks.WebhookSubscriptionActivatedPayload
  | Webhooks.WebhookSubscriptionCancelationRevertedPayload
  | Webhooks.WebhookSubscriptionCancelationScheduledPayload
  | Webhooks.WebhookSubscriptionCanceledPayload
  | Webhooks.WebhookSubscriptionPausedPayload
  | Webhooks.WebhookSubscriptionPauseScheduledPayload
  | Webhooks.WebhookSubscriptionPauseUnscheduledPayload
  | Webhooks.WebhookSubscriptionResumedPayload
  | Webhooks.WebhookSubscriptionStartedPayload
  | Webhooks.WebhookSubscriptionUpdatedPayload
  | Webhooks.WebhookSubscriptionVersionUpdatedPayload;

/** The `type` of any webhook event. */
export type AlgunaWebhookEventType = AlgunaWebhookEvent["type"];

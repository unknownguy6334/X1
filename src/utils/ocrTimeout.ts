/** Shared OCR deadline contract. Provider work fits inside the end-to-end budget,
 * while the transport/client receives a deterministic margin for serialization. */
export const OCR_PROVIDER_TOTAL_BUDGET_MS = 82_000;
export const OCR_END_TO_END_BUDGET_MS = 90_000;
export const OCR_TRANSPORT_MARGIN_MS = 2_500;
export const OCR_SERVER_REQUEST_TIMEOUT_MS = OCR_END_TO_END_BUDGET_MS + OCR_TRANSPORT_MARGIN_MS;
export const OCR_CLIENT_TIMEOUT_MS = OCR_SERVER_REQUEST_TIMEOUT_MS + OCR_TRANSPORT_MARGIN_MS;

// ABOUTME: Recognises the model's "no information" fallback reply, which arrives as a normal 200 response.
// ABOUTME: Shared by the eval script and the public summary renderer so both agree on what counts as a fallback.

/**
 * Matches a reply that opens with the prompts' fallback sentence instead of a summary.
 * Test it against trimmed text. isCacheableResponse does not reject these, so they can sit in KV.
 */
export const FALLBACK_RESPONSE_PATTERN =
  /^(Not enough information available|There is no information available)/i;

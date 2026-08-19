# Idempotency Is a Send Attempt Option

Effect Email models an optional Idempotency Key in parsed Send Options for one send attempt, rather than in Email Message content or provider-specific configuration. This keeps the same provider-neutral Email Message reusable across independent attempts and validates the key before Send Policy or Transport Adapter effects.

The common option does not imply a common guarantee. The Resend Adapter may rely on Resend's provider-backed, time-bounded deduplication; the Test Adapter may deduplicate only for the lifetime of its Layer; and the SMTP Adapter does not deduplicate. SMTP must not translate the key into Message-ID or an Email Header. The SDK does not add a persistent coordinator or automatic retry.

Recovery decisions therefore depend on both the Send Failure disposition and the selected Transport Adapter's declared idempotency guarantee. An ambiguous disposition means acceptance may already have occurred; its deprecated `retryable` compatibility field remains false so callers do not mistake ambiguity for generally safe retry.

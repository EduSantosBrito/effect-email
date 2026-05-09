# Subpath Adapter Exports

Effect Email exports provider-neutral core APIs from the root package and provider/test adapters from subpaths such as `effect-email/resend` and `effect-email/test`. This keeps trusted-runtime provider code out of runtime-neutral imports, makes adapter boundaries explicit, and avoids making later SMTP or provider additions reshape the root API after release.

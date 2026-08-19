Internal back-office: dead-letter replay, tenant resync, entitlement
inspection, impersonation sessions, per-tenant health.

This is the only workspace where tRPC is permitted, and the boundary is
enforced by `.dependency-cruiser.cjs`. Honestly, consider not using it here
either and keeping one API paradigm across the product.

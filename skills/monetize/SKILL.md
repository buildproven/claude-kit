---
name: monetize
auto_invoke: true
description: Commercial launch automation for skills and projects. Guides through Polar.sh setup, license generation, webhook handlers, pricing components, and documentation. Use when user wants to monetize a skill, add paid features, or set up commercial licensing.
context: fork
---

# Monetize Skill — Commercial Launch Automation

Automates setting up commercial licensing for skills and projects. This workflow guides you through all steps needed to launch a paid product using **Polar.sh** (Merchant-of-Record).

## Why Polar.sh (not Stripe direct)

For an indie dev or small team selling globally under ~$50K MRR:

- **MoR vs Stripe-direct**: Polar handles global sales tax / VAT / GST collection and remittance. Stripe-direct means _you_ owe tax in ~30 US states (economic nexus thresholds) plus EU VAT plus UK/AU GST. The hidden compliance cost dominates the ~1.3% MoR premium until you're big enough to industrialize tax with Anrok/Sphere.
- **Built-in customer portal**: cancellations, card updates, invoices. No portal to build.
- **Built-in dunning**: retries, grace periods. No dunning to build.
- **Fees**: 4% + $0.40 vs Stripe's 2.9% + $0.30. Real marginal cost of MoR ≈ 1.3% on a $49 sub. That ~1.3% replaces ~$200-400/mo in tax-tool subscription + your own time.
- **Crossover at ~$50K MRR** — past that, Stripe-direct + Anrok wins. Re-evaluate then.

**When NOT Polar:**

- Already past $50K MRR with US-heavy revenue → Stripe direct + Anrok
- Heavy B2B / enterprise with compliance requirements → Paddle
- One-time digital download, no subscription → Gumroad
- Existing LemonSqueezy customer → migrate to Polar (LemonSqueezy is on a glide path after Stripe acquired them in 2024)

## When to Use This Skill

**Trigger conditions:**

- User mentions monetizing: "monetize my skill", "add paid tier", "commercial license"
- User mentions pricing: "set up pricing", "create pricing page", "add checkout"
- User mentions selling: "sell this skill", "commercial launch", "paid version"

## Prerequisites Check

Before starting, verify:

1. **Polar account**: User needs a Polar.sh account (free to create; KYB required before payouts).
2. **Framework Detection**: Identify project framework (Next.js, Express, Fastify, etc.).
3. **Domain**: Know the production domain for webhook configuration.

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Configuration                                     │
│  - Product name, description, pricing                       │
│  - License type (perpetual, subscription, usage)            │
│  - Framework detection                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: Polar Setup                                       │
│  - Create product in Polar (single product, multiple prices)│
│  - Configure webhook endpoint                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 3: Code Generation                                   │
│  - Webhook handler (subscription events)                    │
│  - License validation middleware                            │
│  - API routes for license checking                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 4: Frontend Components                               │
│  - Pricing table component                                  │
│  - Buy button linking to Polar checkout                     │
│  - License activation form                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 5: Documentation & Email                             │
│  - README purchase/activation sections                      │
│  - License delivery email template                          │
│  - Customer support documentation                           │
└─────────────────────────────────────────────────────────────┘
```

## Stage 1: Configuration

### Gather Product Information

Ask the user for:

1. **Product Name**: What should this be called? (e.g., "Advanced SEO Skill Pro")
2. **Description**: One-line description for the Polar product listing.
3. **Pricing Model**:
   - One-time purchase (perpetual license)
   - Monthly subscription
   - Annual subscription
   - Both monthly and annual (recommended — single Polar product with two recurring prices)
4. **Price Points**: Amount(s) in USD.
5. **License Type**:
   - Per-seat (one license per user)
   - Per-project (one license per project)
   - Unlimited (personal use, unlimited projects)

### Detect Framework

Check for framework indicators:

```bash
# Next.js
ls package.json && grep -q "next" package.json && echo "Next.js detected"

# Express
ls package.json && grep -q '"express"' package.json && echo "Express detected"

# Fastify
ls package.json && grep -q '"fastify"' package.json && echo "Fastify detected"
```

Store detected framework for code generation templates.

## Stage 2: Polar Setup

Polar doesn't have an MCP tool yet. Use the dashboard UI (5-10 min) plus their API for anything programmatic.

### Create the product (dashboard)

1. Go to [polar.sh/dashboard](https://polar.sh/dashboard) → your org → Products → **New Product**
2. Name: _(your product name)_
3. Description: _(your description)_
4. Type: **Subscription**
5. Add **two prices** under the same product:
   - $XX.XX USD / month (recurring monthly)
   - $XXX.XX USD / year (recurring yearly — typically 10x monthly for a 2-month discount)
6. **Save the product ID** — looks like a UUID. You'll need it for `POLAR_PRODUCT_ID`.

> **One product, multiple prices.** Polar groups recurring prices under a single product. This means one tier mapping in your webhook handler regardless of billing cadence — simpler than Stripe's separate-price-IDs model.

### Configure the webhook

In Polar Dashboard → Settings → **Webhooks** → New Webhook:

- URL: `https://yourdomain.com/api/webhooks/polar`
- Events to subscribe to (all five):
  - `subscription.created` — issue license
  - `subscription.active` — idempotent re-issue (renewals, late activations)
  - `subscription.updated` — re-provision on plan change
  - `subscription.canceled` — mark pending_cancel (do NOT revoke yet — customer is paid until period end)
  - `subscription.revoked` — actually end access (fires at period end after cancel, or on hard-fail dunning)
- **Save the signing secret** — starts with `whsec_`. You'll need this for `POLAR_WEBHOOK_SECRET`.

### Environment variables

Add to `.env`:

```bash
POLAR_ACCESS_TOKEN=polar_oat_xxx        # Personal access token for server-side API calls
POLAR_WEBHOOK_SECRET=whsec_xxx          # From webhook setup above
POLAR_PRODUCT_ID=xxxxxxxx-xxxx-xxxx     # The product UUID from above
POLAR_ORG_SLUG=your-org-slug            # For building checkout URLs
```

## Stage 3: Code Generation

### 3a: Webhook Handler

Generate webhook handler based on detected framework.

**Template location:** `skills/monetize/webhook-handler.ts.template`

**For Next.js (App Router):** create `/app/api/webhooks/polar/route.ts`.

**Webhook signature verification:** Polar uses the **standard-webhooks** spec (HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${body}`). Use the `standardwebhooks` npm package — vendor-agnostic, well-maintained:

```bash
npm install standardwebhooks
```

**Key webhook events to handle:**

| Event                   | Action                                         |
| ----------------------- | ---------------------------------------------- |
| `subscription.created`  | Generate license, send email                   |
| `subscription.active`   | Idempotent re-issue (renewal, late activation) |
| `subscription.updated`  | Re-provision (plan/tier changes)               |
| `subscription.canceled` | Mark `pending_cancel` — keep access alive      |
| `subscription.revoked`  | Revoke license, remove from active registry    |

### 3b: License Validation

Generate license validation middleware.

**Template location:** `skills/monetize/license-validation.ts.template`

**License key format:** `PROD-XXXX-XXXX-XXXX-XXXX`

- `PROD`: Product identifier (4 chars, your project prefix)
- `XXXX`: Random alphanumeric segments (derived deterministically from Polar customer ID + tier)

**Validation approaches:**

1. **Database lookup** (recommended for hosted services with subscriptions)
2. **Signed payloads + offline verification** (recommended for CLIs / desktop apps / anything that runs without persistent network)
3. **Polar's built-in license-key benefit** (only if you accept _online-only_ validation against Polar's `/v1/customer-portal/license-keys/validate` endpoint)

> **Important on offline validation:** Polar's built-in license-key feature is online-only. For CLI / CI / air-gapped use cases, sign your own license payloads (Ed25519 or RSA-SHA256) using your private key on the webhook side; ship the public key bundled with your client; verify offline. This is the pattern used by Tailscale and qa-architect.

### 3c: API Routes

Generate license management API routes:

- `POST /api/licenses/activate` — Activate a license key
- `GET /api/licenses/validate` — Check if license is valid
- `POST /api/licenses/deactivate` — Deactivate a license

## Stage 4: Frontend Components

### 4a: Pricing Component

Generate pricing table component.

**Template location:** `skills/monetize/pricing-component.tsx.template`

**Features:**

- Monthly/annual toggle with discount highlight
- Feature comparison list
- Polar checkout link
- Loading states
- Error handling

### 4b: Checkout Integration

Polar provides hosted checkout — you just send users there. No checkout-session API call needed (unlike Stripe).

```typescript
// Direct link to hosted checkout (simplest)
const checkoutUrl = `https://polar.sh/${POLAR_ORG_SLUG}/${PRODUCT_SLUG}?price=${PRICE_ID}`;
window.location.href = checkoutUrl;

// Or use Polar's embeddable checkout for an in-page experience
import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";

PolarEmbedCheckout.create(checkoutUrl, theme);
```

Polar handles success/cancel URLs in the product settings (dashboard), so you typically don't need to pass them per-checkout.

### 4c: License Activation Form

Simple form for users to activate their license:

```
┌─────────────────────────────────────────┐
│  Activate Your License                  │
│                                         │
│  License Key: [________________]        │
│                                         │
│  Email: [________________________]      │
│                                         │
│  [      Activate License       ]        │
└─────────────────────────────────────────┘
```

## Stage 5: Documentation & Email

### 5a: README Sections

Add to project README:

```markdown
## Pricing

[Product Name] is available in the following tiers:

| Plan    | Price | Features                            |
| ------- | ----- | ----------------------------------- |
| Monthly | $X/mo | Full access, updates                |
| Annual  | $X/yr | Full access, updates, 2 months free |

[Get Started →](https://yourdomain.com/pricing)

## License Activation

1. Purchase a license at [yourdomain.com/pricing](https://yourdomain.com/pricing)
2. Check your email for the license key
3. Run: `npx your-tool activate YOUR-LICENSE-KEY`
   Or visit: [yourdomain.com/activate](https://yourdomain.com/activate)

## License Terms

- **Personal License**: Use on unlimited personal projects
- **Commercial License**: Use in commercial products (contact for enterprise)
- **Refund Policy**: Handled by Polar.sh per their refund policy (typically 30 days). Contact us if Polar can't resolve.

Need help? Email support@yourdomain.com
```

### 5b: License Delivery Email

**Template location:** `skills/monetize/license-email.html.template`

**Email content:**

- Thank you message
- License key (prominently displayed)
- Activation instructions
- Quick start guide link
- Support contact
- Note that customer portal (cancel/update card/invoices) is at `polar.sh/dashboard`

### 5c: Customer Support Docs

Create a FAQ section:

1. How do I activate my license?
2. Can I transfer my license?
3. What happens when my subscription expires?
4. How do I get a refund? (→ Polar customer portal)
5. How do I upgrade my plan? (→ Polar customer portal)

## Implementation Checklist

After completing all stages, verify:

- [ ] Polar product and prices created
- [ ] Webhook endpoint configured (5 subscription events subscribed)
- [ ] Environment variables set (dev and production)
- [ ] Webhook handler deployed and receiving events
- [ ] License generation working
- [ ] License validation middleware integrated
- [ ] Pricing page live
- [ ] Checkout flow tested end-to-end (Polar test mode or $1 real product)
- [ ] Email delivery working
- [ ] README updated
- [ ] Test purchase completed successfully

## Testing Workflow

### Test Mode

Polar supports a test environment alongside production. Use it for end-to-end testing:

1. Switch to Polar's test environment in the dashboard
2. Create a test product / test webhook subscription
3. Use Polar's "Send Test Event" button on the webhook config page to replay each event type
4. Verify webhook receives events, license gets generated, email delivered

### Webhook Testing (Local)

Polar doesn't have a CLI-forwarding tool like Stripe's, so use a tunneling service:

```bash
# Use ngrok, cloudflared, or similar
ngrok http 3000

# Update Polar webhook URL to your ngrok URL
# https://abc123.ngrok.io/api/webhooks/polar

# Trigger events from Polar dashboard → Webhooks → Send Test Event
```

### Go Live Checklist

1. Switch to Polar's live environment (separate API keys)
2. Update webhook endpoint to production URL
3. Verify SSL certificate
4. Test with a real $1 purchase end-to-end (refundable)
5. Monitor first few purchases in Polar dashboard

## Templates Reference

| Template                         | Purpose                              |
| -------------------------------- | ------------------------------------ |
| `webhook-handler.ts.template`    | Polar.sh webhook handler             |
| `license-validation.ts.template` | License checking middleware          |
| `pricing-component.tsx.template` | React pricing table + Polar checkout |
| `license-email.html.template`    | License delivery email               |

## Value Proposition

**Without this skill:**

- 3-4 hours manual Polar setup
- Hand-rolled license signing/validation (error-prone)
- Forget steps in documentation
- Inconsistent pricing presentation
- No email templates

**With this skill:**

- 15-minute guided setup
- Tested, secure license validation
- Complete documentation auto-generated
- Professional pricing presentation
- Email templates ready to send

## Future Enhancements

- Stripe-direct fallback for past-$50K-MRR projects
- Paddle integration for enterprise/B2B
- Keygen.sh integration for floating-seat / node-locked licenses
- License revocation list distribution for offline clients
- Usage-based pricing support
- Team/enterprise license tiers
- Coupon/discount code support
- Affiliate tracking
- Revenue analytics dashboard

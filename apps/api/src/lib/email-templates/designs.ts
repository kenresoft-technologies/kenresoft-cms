import type { EmailDesign, EmailDesignId } from '@kenresoft-cms/contracts';
import { EMAIL_DESIGN_IDS } from '@kenresoft-cms/contracts';

// The five built-in, non-editable-from-Standard-mode email designs. Each is a real, original
// Kenresoft layout — table-based, inline-styles-only (the same email-client-compatibility
// discipline shell.ts's own comment already documents: modern CSS layout is unreliable across
// mail clients) — differing in header/logo treatment, button shape, spacing and typographic
// weight, not just color. Every design still emits `{{design.*}}`/`{{site.name}}` tokens for the
// parts that come from the emailBranding Structured Settings module, so a deployment's brand
// colors/footer text apply uniformly regardless of which design is active; `heading`/
// `bodyParagraphsHtml`/`ctaLabel`/`fineprint` arrive already HTML-escaped by the caller (this
// module never escapes or sanitizes — apps/api/src/lib/email-templates/standard-render.ts and
// render.ts's own sanitizeEmailHtml pass are what make that safe) and `ctaUrl`/`preheader` are
// trusted literals the caller controls (a `{{verificationUrl}}`-style token, a fixed sentence),
// never admin-supplied free text.
export interface EmailDesignRenderInput {
  preheader: string;
  logoUrl: string | null;
  heading: string;
  bodyParagraphsHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  fineprint: string;
}

interface EmailDesignDefinition extends EmailDesign {
  render: (input: EmailDesignRenderInput) => string;
}

function logoOrWordmark(logoUrl: string | null, options: { maxHeight: string; color: string; size: string; weight: string }): string {
  if (logoUrl) {
    return `<img src="${logoUrl}" alt="{{site.name}}" height="${options.maxHeight}" style="display:block; max-height:${options.maxHeight}; width:auto; border:0;" />`;
  }
  return `<span style="font-size:${options.size}; font-weight:${options.weight}; color:${options.color}; letter-spacing:-0.01em;">{{site.name}}</span>`;
}

// 1. Modern Minimal — a rounded content card on a soft page background, one accent CTA button.
// This is the original shell every template shipped with before this design registry existed,
// kept bit-for-bit so pre-existing installs see zero visual change when they're on this design.
const modernMinimal: EmailDesignDefinition = {
  id: 'modern-minimal',
  name: 'Modern Minimal',
  description: 'A clean, spacious transactional email with a rounded card and a single accent button. The default.',
  render(input) {
    const { preheader, logoUrl, heading, bodyParagraphsHtml, ctaLabel, ctaUrl, fineprint } = input;
    return `<!doctype html>
<html>
<body style="margin:0; padding:0; background:{{design.pageBackground}}; font-family:{{design.fontStack}};">
  <span style="display:none; max-height:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{{design.pageBackground}};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" style="max-width:{{design.contentWidth}}; background:{{design.contentBackground}}; border-radius:12px; overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:32px 40px 24px 40px; border-bottom:1px solid {{design.borderColor}};">
              ${logoOrWordmark(logoUrl, { maxHeight: '28px', color: '{{design.textColor}}', size: '16px', weight: '600' })}
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:600; color:{{design.textColor}}; letter-spacing:-0.01em;">${heading}</h1>
              ${bodyParagraphsHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;">
                <tr>
                  <td style="border-radius:8px; background:{{design.brandColor}};">
                    <a href="${ctaUrl}" style="display:inline-block; padding:12px 28px; font-size:15px; font-weight:600; color:{{design.buttonTextColor}}; text-decoration:none; border-radius:8px;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0; font-size:13px; color:{{design.mutedTextColor}}; word-break:break-all;">Or paste this link into your browser: <a href="${ctaUrl}" style="color:{{design.brandColor}};">${ctaUrl}</a></p>
              <p style="margin:24px 0 0 0; font-size:13px; color:{{design.mutedTextColor}};">${fineprint}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px; border-top:1px solid {{design.borderColor}}; font-size:12px; color:{{design.mutedTextColor}};">
              {{design.footerText}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  },
};

// 2. Cloudflare-Inspired — an original Kenresoft layout: a solid brand-color header band holding
// the logo/wordmark, a bold heading directly below it, a rounded pill CTA button, generous
// spacing, a plain single-line footer. Reproduces the *principles* of a strong-hierarchy,
// compact, technical-infrastructure transactional email (bold header band, big clear heading,
// one obvious CTA, minimal footer) — no Cloudflare HTML, copy, assets or branding are reused.
const cloudflareInspired: EmailDesignDefinition = {
  id: 'cloudflare-inspired',
  name: 'Cloudflare-Inspired',
  description: 'A bold color header band, strong heading hierarchy and a rounded pill button — a compact, technical, infrastructure-style look.',
  render(input) {
    const { preheader, logoUrl, heading, bodyParagraphsHtml, ctaLabel, ctaUrl, fineprint } = input;
    return `<!doctype html>
<html>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:{{design.fontStack}};">
  <span style="display:none; max-height:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:{{design.contentWidth}}; background:{{design.contentBackground}}; border-radius:10px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:28px 36px; background:{{design.brandColor}};">
              ${logoOrWordmark(logoUrl, { maxHeight: '26px', color: '{{design.buttonTextColor}}', size: '17px', weight: '700' })}
            </td>
          </tr>
          <tr>
            <td style="padding:36px;">
              <h1 style="margin:0 0 18px 0; font-size:24px; line-height:1.3; font-weight:700; color:{{design.textColor}}; letter-spacing:-0.02em;">${heading}</h1>
              ${bodyParagraphsHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 10px 0;">
                <tr>
                  <td style="border-radius:999px; background:{{design.brandColor}};">
                    <a href="${ctaUrl}" style="display:inline-block; padding:13px 32px; font-size:14px; font-weight:700; color:{{design.buttonTextColor}}; text-decoration:none; border-radius:999px; letter-spacing:0.01em;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0; font-size:12px; color:{{design.mutedTextColor}}; word-break:break-all;">${ctaUrl}</p>
              <p style="margin:22px 0 0 0; padding-top:18px; border-top:1px solid {{design.borderColor}}; font-size:12px; color:{{design.mutedTextColor}};">${fineprint}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px; font-size:11px; color:{{design.mutedTextColor}};">
              {{design.footerText}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  },
};

// 3. Corporate — a traditional business layout: square corners, a thin brand-color top rule, a
// left-aligned wordmark/logo, a horizontal divider under the heading, and a boxed, formal
// footer. Deliberately less rounded/playful than the others.
const corporate: EmailDesignDefinition = {
  id: 'corporate',
  name: 'Corporate',
  description: 'A traditional, formal business layout — square corners, a divider under the heading, and a boxed footer.',
  render(input) {
    const { preheader, logoUrl, heading, bodyParagraphsHtml, ctaLabel, ctaUrl, fineprint } = input;
    return `<!doctype html>
<html>
<body style="margin:0; padding:0; background:#eceef1; font-family:Georgia, 'Times New Roman', serif;">
  <span style="display:none; max-height:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceef1;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="100%" style="max-width:{{design.contentWidth}}; background:{{design.contentBackground}}; border-top:4px solid {{design.brandColor}};" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:28px 40px 20px 40px;">
              ${logoOrWordmark(logoUrl, { maxHeight: '24px', color: '{{design.textColor}}', size: '15px', weight: '700' })}
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px 40px;">
              <h1 style="margin:0 0 14px 0; font-size:20px; font-weight:700; color:{{design.textColor}};">${heading}</h1>
              <hr style="border:none; border-top:1px solid {{design.borderColor}}; margin:0 0 20px 0;" />
              <div style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                ${bodyParagraphsHtml}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 10px 0;">
                <tr>
                  <td style="background:{{design.brandColor}};">
                    <a href="${ctaUrl}" style="display:inline-block; padding:12px 30px; font-size:14px; font-weight:600; color:{{design.buttonTextColor}}; text-decoration:none; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0; font-size:12px; color:{{design.mutedTextColor}}; word-break:break-all; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Or copy this link: ${ctaUrl}</p>
              <p style="margin:22px 0 0 0; font-size:12px; color:{{design.mutedTextColor}}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${fineprint}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 40px; background:{{design.pageBackground}}; border-top:1px solid {{design.borderColor}}; font-size:11px; color:{{design.mutedTextColor}}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              {{design.footerText}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  },
};

// 4. Elegant — refined and airy: an uppercase eyebrow label, a large light-weight heading, a
// slim outlined (not filled) button, and a centered, understated footer.
const elegant: EmailDesignDefinition = {
  id: 'elegant',
  name: 'Elegant',
  description: 'Refined and airy, with generous whitespace, a light-weight heading and a slim outlined button.',
  render(input) {
    const { preheader, logoUrl, heading, bodyParagraphsHtml, ctaLabel, ctaUrl, fineprint } = input;
    return `<!doctype html>
<html>
<body style="margin:0; padding:0; background:#faf9f7; font-family:{{design.fontStack}};">
  <span style="display:none; max-height:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;">
    <tr>
      <td align="center" style="padding:56px 16px;">
        <table role="presentation" width="100%" style="max-width:{{design.contentWidth}};" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding:0 20px 32px 20px;">
              ${logoOrWordmark(logoUrl, { maxHeight: '22px', color: '{{design.textColor}}', size: '14px', weight: '500' })}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 20px;">
              <p style="margin:0 0 14px 0; font-size:11px; font-weight:600; letter-spacing:0.16em; text-transform:uppercase; color:{{design.brandColor}};">{{site.name}}</p>
              <h1 style="margin:0 0 22px 0; font-size:28px; font-weight:300; letter-spacing:-0.01em; color:{{design.textColor}};">${heading}</h1>
              <div style="text-align:left;">
                ${bodyParagraphsHtml}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 12px auto;">
                <tr>
                  <td style="border:1px solid {{design.brandColor}}; border-radius:2px;">
                    <a href="${ctaUrl}" style="display:inline-block; padding:12px 34px; font-size:13px; font-weight:500; letter-spacing:0.04em; color:{{design.brandColor}}; text-decoration:none;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0; font-size:12px; color:{{design.mutedTextColor}}; word-break:break-all;">${ctaUrl}</p>
              <p style="margin:26px 0 0 0; font-size:12px; color:{{design.mutedTextColor}}; text-align:left;">${fineprint}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:40px 20px 0 20px; border-top:1px solid {{design.borderColor}}; margin-top:32px; font-size:11px; color:{{design.mutedTextColor}};">
              {{design.footerText}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  },
};

// 5. Simple — deliberately lightweight: no card, no background container, left-aligned plain
// text on a white page, an underlined text link in place of a styled button. Maximum email-
// client compatibility, closest to a well-formatted plain-text message.
const simple: EmailDesignDefinition = {
  id: 'simple',
  name: 'Simple',
  description: 'Very lightweight, plain-text-style layout with no card or background — maximum email-client compatibility.',
  render(input) {
    const { preheader, logoUrl, heading, bodyParagraphsHtml, ctaLabel, ctaUrl, fineprint } = input;
    return `<!doctype html>
<html>
<body style="margin:0; padding:0; background:#ffffff; font-family:{{design.fontStack}};">
  <span style="display:none; max-height:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr>
      <td align="left" style="padding:32px 20px; max-width:{{design.contentWidth}};">
        <table role="presentation" width="100%" style="max-width:{{design.contentWidth}};" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-bottom:24px;">
              ${logoOrWordmark(logoUrl, { maxHeight: '20px', color: '{{design.textColor}}', size: '14px', weight: '600' })}
            </td>
          </tr>
          <tr>
            <td>
              <h1 style="margin:0 0 14px 0; font-size:18px; font-weight:600; color:{{design.textColor}};">${heading}</h1>
              ${bodyParagraphsHtml}
              <p style="margin:20px 0 0 0; font-size:14px;">
                <a href="${ctaUrl}" style="color:{{design.brandColor}}; font-weight:600; text-decoration:underline;">${ctaLabel} &rarr;</a>
              </p>
              <p style="margin:8px 0 0 0; font-size:12px; color:{{design.mutedTextColor}}; word-break:break-all;">${ctaUrl}</p>
              <p style="margin:20px 0 0 0; font-size:12px; color:{{design.mutedTextColor}};">${fineprint}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px; font-size:11px; color:{{design.mutedTextColor}};">
              {{design.footerText}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  },
};

const EMAIL_DESIGNS: Record<EmailDesignId, EmailDesignDefinition> = {
  'modern-minimal': modernMinimal,
  'cloudflare-inspired': cloudflareInspired,
  corporate,
  elegant,
  simple,
};

export function getEmailDesign(id: EmailDesignId): EmailDesignDefinition {
  return EMAIL_DESIGNS[id];
}

export function listEmailDesigns(): EmailDesign[] {
  return EMAIL_DESIGN_IDS.map((id) => {
    const { id: designId, name, description } = EMAIL_DESIGNS[id];
    return { id: designId, name, description };
  });
}

export const DEFAULT_DESIGN_ID: EmailDesignId = 'modern-minimal';

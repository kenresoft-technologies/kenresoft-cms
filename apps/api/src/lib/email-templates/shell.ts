// Builds the *stored default* HTML for a transactional email — called once, at definition time
// in defaults.ts, not on every render. The output is plain, editable HTML with `{{design.*}}`/
// `{{site.*}}` tokens left in place, so an admin opening "Advanced HTML" sees real markup they
// can tweak, not a black-box component. Table-based layout (mail clients ignore modern CSS
// layout), inline styles only, one primary CTA button, a plain-text fallback URL, and a short
// security/expiration line — the "premium, modern, technical, restrained, trustworthy" shell
// every default template shares, matching Kenresoft's own dark/navy identity by default while
// staying fully overridable per deployment via the emailBranding Structured Settings module
// (design tokens are substituted at render time, apps/api/src/lib/email-templates/render.ts).
export function emailShell(options: {
  preheader: string;
  heading: string;
  bodyParagraphsHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  fineprint: string;
}): string {
  const { preheader, heading, bodyParagraphsHtml, ctaLabel, ctaUrl, fineprint } = options;
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
              <span style="font-size:16px; font-weight:600; color:{{design.textColor}}; letter-spacing:-0.01em;">{{site.name}}</span>
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
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'FlowDrop <noreply@flowdrop.app>';
const APP_URL = process.env.APP_URL || 'https://flow-drop.app';

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function buildTrialReminderHtml(expiresAt) {
  const expiryDate = formatDate(expiresAt);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Inter',Arial,sans-serif;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;">⚡ FlowDrop</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#fff;">
                Your free trial expires in 2 days
              </h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a0a0a0;">
                Your FlowDrop API key expires on <strong style="color:#fff;">${expiryDate}</strong>.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a0a0a0;">
                After that, your API key will stop working and uploaded files will be deleted.
                Upgrade now to keep your workflows running without interruption.
              </p>

              <!-- Pricing -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:16px;background:#242424;border-radius:8px;border:1px solid #333;vertical-align:top;">
                    <div style="font-weight:600;color:#fff;margin-bottom:4px;">Starter — $9/mo</div>
                    <div style="font-size:13px;color:#888;">30-day retention · 50MB uploads · 1,000/mo</div>
                  </td>
                  <td width="12"></td>
                  <td style="padding:16px;background:#1e1730;border-radius:8px;border:1px solid #5a3ea0;vertical-align:top;">
                    <div style="font-weight:600;color:#fff;margin-bottom:4px;">Pro — $29/mo ✦</div>
                    <div style="font-size:13px;color:#888;">Files never expire · 200MB uploads · 6,000/mo</div>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <a href="${APP_URL}/dashboard"
                 style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
                Upgrade Now →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #2a2a2a;">
              <p style="margin:0;font-size:12px;color:#555;line-height:1.5;">
                You're receiving this because you have a free FlowDrop account.
                If you no longer need it, you can ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendTrialReminderEmail(email, expiresAt) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email to', email);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Your FlowDrop trial expires in 2 days',
      html: buildTrialReminderHtml(expiresAt),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

module.exports = { sendTrialReminderEmail };

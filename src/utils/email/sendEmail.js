import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '../../templates/emails');

let resendClient = null;

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured in environment variables');
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
};

/**
 * Replace {{variable}} placeholders in an HTML string.
 */
const renderTemplate = (html, data = {}) => {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

/**
 * Load an email HTML template from src/templates/emails
 * @param {string} templateFile - e.g. 'forgotPassword.html'
 */
export const loadEmailTemplate = async (templateFile, data = {}) => {
  const safeName = path.basename(templateFile);
  const templatePath = path.join(TEMPLATES_DIR, safeName);
  const raw = await fs.readFile(templatePath, 'utf-8');
  return renderTemplate(raw, data);
};

/**
 * Reusable email sender powered by Resend.
 *
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email(s)
 * @param {string} options.subject - Email subject
 * @param {string} [options.template] - Template filename (e.g. 'forgotPassword.html')
 * @param {Object} [options.data] - Variables for template placeholders {{name}}, {{otp}}, etc.
 * @param {string} [options.html] - Raw HTML (used if template is not provided)
 * @param {string} [options.text] - Optional plain-text body
 * @param {string} [options.from] - Override default from address
 * @param {string} [options.fromName] - Override default from display name
 * @returns {Promise<{ success: boolean, id?: string, skipped?: boolean, error?: string }>}
 */
export const sendEmail = async ({
  to,
  subject,
  template,
  data = {},
  html,
  text,
  from,
  fromName
} = {}) => {
  if (!to) throw new Error('sendEmail: "to" is required');
  if (!subject) throw new Error('sendEmail: "subject" is required');
  if (!template && !html) {
    throw new Error('sendEmail: provide either "template" or "html"');
  }

  const recipients = Array.isArray(to) ? to : [to];
  const htmlBody = template
    ? await loadEmailTemplate(template, data)
    : renderTemplate(html, data);

  const senderName = fromName || process.env.RESEND_FROM_NAME || 'SARRA CRM';
  const senderEmail = from || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const fromAddress = `${senderName} <${senderEmail}>`;

  // Allow local testing without a real Resend key
  if (
    !process.env.RESEND_API_KEY ||
    process.env.RESEND_API_KEY.includes('dummy') ||
    process.env.EMAIL_DRY_RUN === 'true'
  ) {
    console.log('\n========== EMAIL (DRY RUN) ==========');
    console.log(`To:      ${recipients.join(', ')}`);
    console.log(`From:    ${fromAddress}`);
    console.log(`Subject: ${subject}`);
    if (data?.otp) console.log(`OTP:     ${data.otp}`);
    console.log('Template/HTML rendered (preview truncated):');
    console.log(htmlBody.slice(0, 400).replace(/\s+/g, ' ') + '...');
    console.log('=====================================\n');
    return { success: true, skipped: true, id: 'dry-run' };
  }

  try {
    const resend = getResendClient();
    const { data: result, error } = await resend.emails.send({
      from: fromAddress,
      to: recipients,
      subject,
      html: htmlBody,
      ...(text && { text })
    });

    if (error) {
      console.error('[sendEmail] Resend error:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }

    console.log(`[sendEmail] Sent to ${recipients.join(', ')} | id=${result?.id}`);
    return { success: true, id: result?.id };
  } catch (err) {
    console.error('[sendEmail] Unexpected error:', err);
    return { success: false, error: err.message || 'Failed to send email' };
  }
};

export default sendEmail;

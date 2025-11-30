// Privacy policy page

import { Layout } from '../../components/layout';

export function PrivacyPage() {
  return (
    <Layout title="Privacy Policy" description="Privacy policy for Listen To More">
      <h1>Privacy Policy</h1>
      <p>
        <strong>Effective Date:</strong> September 16, 2024
      </p>

      <p>
        At "Listen To More," we value your privacy. This Privacy Policy outlines how we handle your
        information when you use our website and Discord bot.
      </p>

      <h2>1. Information We Collect</h2>
      <p>
        We do not collect any personally identifiable information (PII). We only gather aggregated
        analytics to monitor the performance of our services and to improve user experience.
      </p>

      <h2>2. Use of Information</h2>
      <p>
        The aggregated data we collect is used solely for understanding usage patterns and for
        optimizing the website and Discord bot. This includes metrics like the number of
        interactions, frequency of usage, and general performance data.
      </p>

      <h2>3. Sharing of Information</h2>
      <p>
        We do not share, sell, or disclose your information to third parties. Aggregated analytics
        data may be used internally for service improvements but will never contain identifiable
        information.
      </p>

      <h2>4. Security</h2>
      <p>
        We take reasonable measures to protect the data we collect from unauthorized access,
        alteration, or destruction. However, no method of transmission over the internet or
        electronic storage is completely secure, and we cannot guarantee absolute security.
      </p>

      <h2>5. Changes to the Privacy Policy</h2>
      <p>
        We may update this policy periodically, and any changes will be reflected on our website. By
        continuing to use the services, you agree to the terms of the updated privacy policy.
      </p>

      <h2>6. Contact Us</h2>
      <p>
        If you have any questions about these terms or the privacy policy, feel free to{' '}
        <a href="https://elezea.com/contact">contact me</a>.
      </p>
    </Layout>
  );
}

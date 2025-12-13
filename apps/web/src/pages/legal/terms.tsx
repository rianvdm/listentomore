// Terms of Service page

import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';

interface TermsPageProps {
  currentUser?: User | null;
}

export function TermsPage({ currentUser }: TermsPageProps) {
  return (
    <Layout title="Terms of Service" description="Terms of Service for Listen To More" currentUser={currentUser}>
      <h1>Terms of Service</h1>
      <p>
        <strong>Effective Date:</strong> September 16, 2024
      </p>

      <p>
        Welcome to the "Listen To More" website and Discord bot. By accessing or using our services,
        you agree to the following terms and conditions. If you do not agree to these terms, please
        refrain from using our services.
      </p>

      <h2>1. Use of Services</h2>
      <p>
        You may use the "Listen To More" website and Discord bot for personal, non-commercial
        purposes. We reserve the right to modify, suspend, or discontinue any part of our services
        without prior notice.
      </p>

      <h2>2. User Conduct</h2>
      <p>
        You agree not to use the "Listen To More" services for any unlawful or malicious purposes.
        Any attempts to exploit or harm the website, Discord bot, or its users are strictly
        prohibited.
      </p>

      <h2>3. Intellectual Property</h2>
      <p>
        The content, design, and code of the "Listen To More" website and Discord bot are owned by
        us and are protected under intellectual property laws. You may not reproduce, distribute, or
        modify any part of the services without our permission.
      </p>

      <h2>4. Limitation of Liability</h2>
      <p>
        We are not responsible for any damages or losses that arise from your use of the services,
        including but not limited to data loss, interruptions, or technical issues. The services are
        provided "as is," and we make no guarantees about the accuracy or reliability of the
        information provided.
      </p>

      <h2>5. Changes to the Terms</h2>
      <p>
        We may update these terms from time to time, and the most current version will be posted on
        our website. Your continued use of the services after any changes means that you accept the
        updated terms.
      </p>
    </Layout>
  );
}

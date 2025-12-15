import { RegistrationFormClient } from "./RegistrationFormClient";

export default function Page() {
  return (
    <main>
      <header className="header">
        <h1>Conference registration</h1>
        <p>
          This page is intentionally buggy and is meant to be used with the Baiq Autofix GitHub Action.
        </p>
        <div className="badgeRow">
          <span className="badge">Next.js (server actions)</span>
          <span className="badge">Cross-field validation</span>
          <span className="badge">Intentionally buggy</span>
        </div>
      </header>

      <section className="card">
        <div className="cardInner">
          <RegistrationFormClient />

          <div className="footerNote">
            Tip: create GitHub issues from the user stories/test cases in this demo’s README, then label a bug
            issue with <code>autofix</code> to trigger the workflow.
          </div>
        </div>
      </section>
    </main>
  );
}

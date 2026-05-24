export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">
          Clinical Trial Eligibility Matcher
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Upload a patient FHIR Bundle and trial eligibility criteria to get a
          structured eligibility verdict with citations.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <section
          aria-label="Patient"
          className="rounded-lg border border-gray-200 p-4"
        >
          <h2 className="mb-2 text-sm font-medium text-gray-700">Patient</h2>
        </section>

        <section
          aria-label="Criteria"
          className="rounded-lg border border-gray-200 p-4"
        >
          <h2 className="mb-2 text-sm font-medium text-gray-700">Criteria</h2>
        </section>

        <section
          aria-label="Results"
          className="rounded-lg border border-gray-200 p-4"
        >
          <h2 className="mb-2 text-sm font-medium text-gray-700">Results</h2>
        </section>
      </div>
    </main>
  );
}

interface WizardStepperProps {
  isEditing: boolean;
  intro: string;
  stepLabels: string[];
  wizardStep: number;
  structureWizardStep: number;
  nameFilled: boolean;
  structureComplete: boolean;
  onSelectStep: (step: number) => void;
}

/** The numbered setup steps shown above the wizard body. */
export default function WizardStepper({
  isEditing,
  intro,
  stepLabels,
  wizardStep,
  structureWizardStep,
  nameFilled,
  structureComplete,
  onSelectStep,
}: WizardStepperProps) {
  return (
    <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-4">
      <h2 className="font-semibold text-blue-950">Create and publish in one workspace</h2>
      <p className="mt-1 text-sm text-blue-900">{intro}</p>
      <ol
        className={`mt-3 grid gap-2 text-sm ${stepLabels.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}
        aria-label="Definition setup steps"
      >
        {stepLabels.map((label, index) => {
          const step = index + 1;
          // New definitions move forward with Next; saved ones can jump between sections once the structure is complete.
          const reachable = step <= wizardStep || Boolean(
            isEditing && nameFilled && (step <= structureWizardStep || structureComplete),
          );
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={wizardStep === step ? 'step' : undefined}
                onClick={() => onSelectStep(step)}
                className={`w-full rounded px-3 py-2 text-left font-medium disabled:cursor-default ${
                  wizardStep === step
                    ? 'bg-blue-600 text-white'
                    : step < wizardStep
                      ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                      : 'bg-white/80 text-blue-900 enabled:hover:bg-white'
                }`}
              >
                {step}. {label}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

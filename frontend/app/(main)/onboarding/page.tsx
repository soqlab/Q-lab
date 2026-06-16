"use client";

import OnboardingWizard from "../../../components/OnboardingWizard";

export default function OnboardingPage() {
  return (
    <OnboardingWizard
      forceShow={true}
      onDismiss={() => window.history.back()}
    />
  );
}

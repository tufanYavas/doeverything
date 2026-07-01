import { BrandMark } from './BrandMark';

export const LoadingSpinner = () => (
  <div className="bg-background flex h-full min-h-screen items-center justify-center">
    <BrandMark size={40} pulsing />
  </div>
);

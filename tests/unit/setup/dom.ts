/**
 * DOM-project setup: jest-dom matchers + automatic React Testing Library
 * cleanup between tests. Loaded only by the `dom` Vitest project.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

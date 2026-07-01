import '@src/index.css';
import Blocked from '@src/Blocked';
import { createRoot } from 'react-dom/client';

const init = () => {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) throw new Error('Can not find #app-container');
  createRoot(appContainer).render(<Blocked />);
};

init();

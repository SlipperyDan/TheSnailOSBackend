import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { FirebaseAuthGate } from './components/FirebaseAuthGate';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FirebaseAuthGate>
      <App />
    </FirebaseAuthGate>
  </StrictMode>,
);

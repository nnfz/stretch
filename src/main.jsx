import ReactDOM from 'react-dom/client';
import App from './App';
import { AppFocusProvider } from './hooks/AppFocusContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppFocusProvider>
    <App />
  </AppFocusProvider>
);
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './styles/base.css';
import './styles/layout.css';
import './styles/chat.css';
import './styles/voice.css';
import './styles/modals.css';
import './styles/themes.css';

createRoot(document.getElementById('root')).render(<App />);

import { Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home.js';
import { Explore } from './pages/Explore.js';
import { Server } from './pages/Server.js';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/explore" element={<Explore />} />
      <Route path="/servers/:serverId" element={<Server />} />
    </Routes>
  );
}

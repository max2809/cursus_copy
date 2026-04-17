import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import AuthVerify from "./pages/AuthVerify";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/verify" element={<AuthVerify />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from './Home';
import Registration from '../registration/registration';
import Login from '../login/login';
import LK from '../lk/lk';
import SiteConnectPage from "../site-connect/SiteConnectPage";
import ProtectedRoute from "../../components/protectedroute";
import ReferralCaptureOnMount from "../../components/ReferralCaptureOnMount";
import OAuthLoginHashRedirect from "../../components/OAuthLoginHashRedirect";

function App() {
  return (
    <BrowserRouter>
      <OAuthLoginHashRedirect />
      <ReferralCaptureOnMount />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/registration" element={<Registration />} /> 
        <Route path="/login" element={<Login />} />

        <Route path="/site-connect" element={<ProtectedRoute><SiteConnectPage /></ProtectedRoute>} />
        <Route path="/lk/*" element={<ProtectedRoute><LK /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

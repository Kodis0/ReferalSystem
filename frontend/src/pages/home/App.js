import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from './Home';
import Registration from '../registration/registration';
import Login from '../login/login';
import LK from '../lk/lk';
import ProtectedRoute from "../../components/protectedroute";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/registration" element={<Registration />} /> 
        <Route path="/login" element={<Login />} />

        <Route path="/lk/*" element={<ProtectedRoute><LK /></ProtectedRoute>} />
    
      </Routes>
    </BrowserRouter>
  );
}

export default App;

import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "../components/protectedroute";
import LK from "../pages/lk/lk";

function SidebarRouter() {
    return (
        <Routes>
            <Route path="/LK/*" element={<ProtectedRoute><LK /></ProtectedRoute>} />
        </Routes>
    );
}

export default SidebarRouter;
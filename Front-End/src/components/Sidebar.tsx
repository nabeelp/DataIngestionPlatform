//#region IMPORTS
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  FileText,
  Settings,
  Search,
  UploadCloud,
  Menu,
  X,
  HelpCircle,
  ChevronRight,
  History,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useState } from "react";
//#endregion

//#region MAIN COMPONENT
const Sidebar = () => {
  //#region HOOKS
  const location = useLocation();
  const { user } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  //#endregion

  //#region STATE
  const isAdmin = user?.Role === "admin";
  //#endregion

  //#region MENU ITEMS
  const userMenuItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboard size={18} />,
      path: "/",
    },
    {
      name: "Uploads",
      icon: <Upload size={18} />,
      path: "/upload",
    },
    {
      name: "History",
      icon: <History size={18} />,
      path: "/history",
    },
    {
      name: "My Files",
      icon: <FileText size={18} />,
      path: "/definitions",
    },
    {
      name: "Rules",
      icon: <Settings size={18} />,
      path: "/rules",
    },
    // { name: "Lookups", icon: <Search size={18} />, path: "/lookups" },
  ];

  const adminMenuItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboard size={18} />,
      path: "/",
    },
    {
      name: "Users Management",
      icon: <FileText size={18} />,
      path: "/admin/users",
    },
    {
      name: "Files",
      icon: <FileText size={18} />,
      path: "/admin/file-definitions",
    },
    {
      name: "Audit Logs",
      icon: <FileText size={18} />,
      path: "/admin/audit-logs",
    },
    {
      name: "Monitoring",
      icon: <Settings size={18} />,
      path: "/admin/monitoring",
    },
    // { name: "Compliance", icon: <Search size={18} />, path: "/admin/compliance" },
  ];

  const menuItems = isAdmin ? adminMenuItems : userMenuItems;
  //#endregion

  //#region RENDER
  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-gray-200"
      >
        {isMobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative z-40 h-screen bg-white border-r border-slate-200 flex flex-col transition-transform duration-300
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          w-[240px]
        `}
      >
        {/* Logo */}
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 flex items-center justify-center flex-shrink-0">
              <UploadCloud
                size={20}
                className="text-white"
              />
            </div>

            <div className="min-w-0">
              <h2 className="font-semibold text-base text-slate-900 truncate">
                Manual File Upload
              </h2>

              <p className="text-xs text-slate-500">
                Data Ingestion Platform
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 space-y-1.5 flex-1 overflow-y-auto">
          {menuItems.map((item) => {
            const active = location.pathname === item.path;

            return (
              <Link
                key={item.name}
                to={item.path}
                onClick={() => setIsMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  active
                    ? "bg-gradient-to-r from-blue-700 to-blue-500 text-white shadow-md"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.icon}

                <span className="text-sm font-medium truncate">
                  {item.name}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="mt-auto p-4 border-t border-slate-100">
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-3">
              <HelpCircle size={16} />
              <span>Help & Support</span>
            </div>

            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
    </>
  );
  //#endregion
};

//#endregion

//#region EXPORT
export default Sidebar;
//#endregion
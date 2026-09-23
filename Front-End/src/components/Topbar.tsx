//#region IMPORTS
import {
  Bell,
  ChevronDown,
  Download,
  Search,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
//#endregion

//#region MAIN COMPONENT
const Topbar = () => {
  //#region HOOKS
  const { user, logout } = useAuth();
  //#endregion

  //#region HANDLERS
  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  const getInitials = (email: string) => {
    return email ? email.charAt(0).toUpperCase() : "U";
  };
  //#endregion

  //#region RENDER
  return (
    <header className="bg-white border-b border-slate-200 px-4 md:px-6 lg:px-8 py-4 flex items-center justify-between">
      {/* Search */}
      <div className="relative w-full max-w-[500px] hidden md:block">
        <Search
          size={18}
          className="absolute left-4 top-3.5 text-slate-400"
        />

        <input
          type="text"
          placeholder="Search..."
          className="w-full h-11 rounded-xl border border-slate-200 pl-12 pr-20 outline-none focus:border-blue-400"
        />

        <div className="absolute right-3 top-2.5 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-500">
          ⌘ K
        </div>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4 md:gap-6 ml-auto">
        {/* Notifications */}
        <div className="relative cursor-pointer">
          <Bell
            size={20}
            className="text-slate-700"
          />

          <div className="absolute -top-2 -right-2 h-5 w-5 bg-blue-600 rounded-full text-white text-[10px] flex items-center justify-center">
            3
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block h-8 w-px bg-slate-200" />

        {/* User Menu */}
        <div className="relative group">
          <div className="flex items-center gap-3 cursor-pointer">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
              {getInitials(user?.email || "")}
            </div>

            <span className="hidden md:block font-medium text-slate-800 max-w-[220px] truncate">
              {user?.email || "User"}
            </span>

            <ChevronDown
              size={16}
              className="text-slate-500"
            />
          </div>

          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
            <div className="py-2">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Export Button */}
        {/* <button className="hidden lg:flex h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white items-center gap-2 transition-colors">
          <Download size={18} />
          Export
        </button> */}
      </div>
    </header>
  );
  //#endregion
};
//#endregion

//#region EXPORT
export default Topbar;
//#endregion
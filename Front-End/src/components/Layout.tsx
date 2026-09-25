//#region IMPORTS
import { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
//#endregion

//#region INTERFACES
interface LayoutProps {
  children?: ReactNode;
}
//#endregion

//#region MAIN COMPONENT
export default function Layout({
  children,
}: LayoutProps) {
  //#region RENDER
  return (
    <div className="h-screen flex bg-[#F7F9FC] overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation */}
        <Topbar />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-4 md:px-6 lg:px-8 py-4 md:py-6">
            {children || <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
  //#endregion
}
//#endregion
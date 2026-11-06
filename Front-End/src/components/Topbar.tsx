//#region IMPORTS
import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, FileText, Search, UploadCloud } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/http";
import { roleBasePath } from "../config/routes";
//#endregion

//#region TYPES
interface SearchResults {
  definitions: { id: string; name: string; description: string }[];
  uploads: { id: string; filename: string; status: string; uploadedAt: string }[];
}

interface ResultItem {
  key: string;
  label: string;
  detail: string;
  to: string;
  kind: "definition" | "upload";
}
//#endregion

//#region MAIN COMPONENT
const Topbar = () => {
  //#region HOOKS
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const isAdmin = user?.Role === "admin";
  //#endregion

  //#region EFFECTS
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiRequest<SearchResults>('/search', { query: { q: query } });
        if (cancelled) return;
        setResults([
          ...data.definitions.map((def) => ({
            key: `def-${def.id}`,
            label: def.name,
            detail: def.description || "File definition",
            to: isAdmin ? "/admin/file-definitions" : "/definitions",
            kind: "definition" as const,
          })),
          ...data.uploads.map((upload) => ({
            key: `upl-${upload.id}`,
            label: upload.filename,
            detail: `${upload.status.replace(/_/g, " ").toLowerCase()} • ${new Date(upload.uploadedAt).toLocaleDateString()}`,
            to: `${isAdmin ? '/admin/history' : '/history'}/${upload.id}`,
            kind: "upload" as const,
          })),
        ]);
        setActiveIndex(0);
        setSearchError(null);
      } catch (err) {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, isAdmin]);
  //#endregion

  //#region HANDLERS
  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const getInitials = (email: string) => {
    return email ? email.charAt(0).toUpperCase() : "U";
  };

  const goTo = (item: ResultItem) => {
    setOpen(false);
    setTerm("");
    navigate(item.to);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      goTo(results[activeIndex]);
    }
  };
  //#endregion

  const showDropdown = open && term.trim().length >= 2;

  //#region RENDER
  return (
    <header className="bg-white border-b border-slate-200 px-4 md:px-6 lg:px-8 py-4 flex items-center justify-between">
      {/* Search */}
      <div className="relative w-full max-w-[500px] hidden md:block">
        <Search size={18} className="absolute left-4 top-3.5 text-slate-400" />

        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="global-search-results"
          aria-label="Search definitions and uploads"
          placeholder="Search definitions and uploads..."
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleSearchKeyDown}
          className="w-full h-11 rounded-xl border border-slate-200 pl-12 pr-20 outline-none focus:border-blue-400"
        />

        <div className="absolute right-3 top-2.5 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-500">
          Ctrl K
        </div>

        {showDropdown && (
          <ul
            id="global-search-results"
            role="listbox"
            className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto py-2"
          >
            {searching && results.length === 0 && (
              <li className="px-4 py-2 text-sm text-slate-500">Searching...</li>
            )}
            {searchError && <li className="px-4 py-2 text-sm text-red-600">{searchError}</li>}
            {!searching && !searchError && results.length === 0 && (
              <li className="px-4 py-2 text-sm text-slate-500">No matches</li>
            )}
            {results.map((item, index) => (
              <li
                key={item.key}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  goTo(item);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`px-4 py-2 flex items-center gap-3 cursor-pointer ${index === activeIndex ? "bg-slate-50" : ""}`}
              >
                {item.kind === "definition" ? (
                  <FileText size={16} className="text-blue-600 flex-shrink-0" />
                ) : (
                  <UploadCloud size={16} className="text-emerald-600 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{item.label}</div>
                  <div className="text-xs text-slate-500 truncate">{item.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4 md:gap-6 ml-auto">
        <Link to={`${roleBasePath(user?.Role)}/history`} className="text-slate-700 hover:text-blue-600" aria-label="Upload history" title="Upload history">
          <Bell size={20} />
        </Link>

        {/* Divider */}
        <div className="hidden sm:block h-8 w-px bg-slate-200" />

        {/* User Menu */}
        <div className="relative group">
          <button type="button" className="flex items-center gap-3 cursor-pointer" aria-haspopup="menu">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
              {getInitials(user?.email || "")}
            </div>

            <span className="hidden md:block font-medium text-slate-800 max-w-[220px] truncate">
              {user?.email || "User"}
            </span>

            <ChevronDown size={16} className="text-slate-500" />
          </button>

          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
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
      </div>
    </header>
  );
  //#endregion
};
//#endregion

//#region EXPORT
export default Topbar;
//#endregion

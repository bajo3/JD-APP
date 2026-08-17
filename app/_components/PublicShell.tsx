import { PublicFooter } from "./PublicFooter";
import { PublicHeader } from "./PublicHeader";
import { BottomNav } from "./BottomNav";
export function PublicShell({ children }: { children: React.ReactNode }) { return <><PublicHeader/>{children}<PublicFooter/><BottomNav/></>; }

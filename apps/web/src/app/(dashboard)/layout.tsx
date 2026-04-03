import { Sidebar } from "@/components/layout/sidebar";
import { Breadcrumb } from "@/components/layout/Breadcrumb";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Breadcrumb />
          {children}
        </div>
      </main>
    </div>
  );
}

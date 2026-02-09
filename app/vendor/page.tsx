import VendorDashboardClient from "./VendorDashboardClient";
import ClientOnly from "./ClientOnly";

export default function VendorPage() {
  return (
    <ClientOnly>
      <VendorDashboardClient />
    </ClientOnly>
  );
}

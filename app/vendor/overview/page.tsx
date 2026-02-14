import ClientOnly from "../ClientOnly";
import OverviewClient from "./OverviewClient";

export default function VendorOverviewPage() {
  return (
    <ClientOnly>
      <OverviewClient />
    </ClientOnly>
  );
}


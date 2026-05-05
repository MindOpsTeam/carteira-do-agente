import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useTenantId(): string | null {
  const [tenantId, setTenantId] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const fromJwt = (data.user?.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
      if (fromJwt) {
        setTenantId(fromJwt);
        return;
      }
      const { data: tu } = await supabase
        .from("tenants_users")
        .select("tenant_id")
        .limit(1)
        .maybeSingle();
      setTenantId(tu?.tenant_id ?? null);
    })();
  }, []);
  return tenantId;
}

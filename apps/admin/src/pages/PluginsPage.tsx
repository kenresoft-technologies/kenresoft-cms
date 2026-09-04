import { Puzzle } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useUpdatePluginEnablement, usePlugins } from '@/lib/queries/plugins';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Core's page for managing the plugin registry itself (docs/PLUGINS.md) — deliberately not
// under apps/admin/src/plugins/, which is reserved for an individual plugin's own contributed
// pages. Lists every plugin bundled into this deployment (its code already compiled into the
// Worker) with a live enable/disable toggle — toggling takes effect immediately, no redeploy;
// adding a genuinely new plugin still requires a code change and redeploy, which this page
// can't do anything about.
export function PluginsPage() {
  const { data: plugins, isPending, error } = usePlugins();
  const updateEnablement = useUpdatePluginEnablement();

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await updateEnablement.mutateAsync({ id, enabled });
      toast.success(enabled ? 'Plugin enabled' : 'Plugin disabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update plugin');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Plugins' }]} />
      <PageHeader
        title="Plugins"
        description="Every plugin bundled into this deployment. Toggling takes effect immediately — no redeploy. Adding a new plugin still requires a code change and redeploy."
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plugin</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={3} />
          </Table>
        </div>
      ) : null}

      {plugins && plugins.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No plugins bundled"
          description="No plugin packages are compiled into this deployment yet."
        />
      ) : null}

      {plugins && plugins.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plugin</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.map((plugin) => (
                <TableRow key={plugin.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{plugin.name}</span>
                      {plugin.description ? (
                        <span className="text-xs text-muted-foreground">{plugin.description}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plugin.version}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={(checked) => void handleToggle(plugin.id, checked)}
                      disabled={updateEnablement.isPending}
                      aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

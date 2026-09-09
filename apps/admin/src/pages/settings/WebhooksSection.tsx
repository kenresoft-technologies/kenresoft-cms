import { useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useContentTypes } from '@/lib/queries/content-types';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useRegenerateWebhookSecret,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
  type WebhookInput,
} from '@/lib/queries/webhooks';
import { WEBHOOK_EVENTS } from '@/lib/types';
import type { Webhook, WebhookEvent } from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const EVENT_LABELS: Record<WebhookEvent, string> = {
  'entry.created': 'Entry created',
  'entry.updated': 'Entry updated',
  'entry.published': 'Entry published',
  'entry.unpublished': 'Entry unpublished',
  'entry.deleted': 'Entry deleted',
};

function SecretRevealDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  function copy() {
    navigator.clipboard.writeText(secret ?? '');
    toast.success('Secret copied');
  }

  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing secret</DialogTitle>
          <DialogDescription>
            Shown only this once — save it now. Use it to verify the{' '}
            <code className="rounded bg-muted px-1">X-Kenresoft-Signature</code> header (HMAC-SHA256
            of the raw request body) on every delivery.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm break-all">
          {secret}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="gap-1.5" onClick={copy}>
            <Copy className="size-3.5" />
            Copy
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhookFormDialog({
  webhook,
  open,
  onOpenChange,
  onCreated,
}: {
  webhook?: Webhook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (secret: string) => void;
}) {
  const { data: contentTypes } = useContentTypes();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();

  const [url, setUrl] = useState(webhook?.url ?? '');
  const [events, setEvents] = useState<WebhookEvent[]>(webhook?.events ?? []);
  const [contentTypeId, setContentTypeId] = useState<string>(webhook?.contentTypeId ?? 'all');
  const [error, setError] = useState<string | null>(null);

  const isEditing = webhook !== undefined;
  const isPending = createWebhook.isPending || updateWebhook.isPending;

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setEvents((prev) => (checked ? [...prev, event] : prev.filter((e) => e !== event)));
  }

  async function handleSubmit() {
    setError(null);
    if (events.length === 0) {
      setError('Select at least one event');
      return;
    }

    const input: WebhookInput = {
      url,
      events,
      contentTypeId: contentTypeId === 'all' ? null : contentTypeId,
    };

    try {
      if (isEditing) {
        await updateWebhook.mutateAsync({ id: webhook.id, ...input });
        toast.success('Webhook updated');
      } else {
        const created = await createWebhook.mutateAsync(input);
        toast.success('Webhook created');
        onCreated?.(created.secret);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save webhook');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit webhook' : 'Add webhook'}</DialogTitle>
          <DialogDescription>
            Fires a signed POST request to this URL whenever a matching event happens.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="webhook-url">URL</Label>
            <Input
              id="webhook-url"
              type="url"
              required
              placeholder="https://example.com/webhooks/kenresoft-cms"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Events</Label>
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={events.includes(event)} onCheckedChange={(checked) => toggleEvent(event, checked === true)} />
                  {EVENT_LABELS[event]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Content type</Label>
            <Select value={contentTypeId} onValueChange={setContentTypeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All content types</SelectItem>
                {(contentTypes ?? []).map((ct) => (
                  <SelectItem key={ct.id} value={ct.id}>
                    {ct.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create webhook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesDialog({ webhookId, onOpenChange }: { webhookId: string | null; onOpenChange: (open: boolean) => void }) {
  const { data: deliveries } = useWebhookDeliveries(webhookId);

  return (
    <Dialog open={webhookId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Delivery log</DialogTitle>
          <DialogDescription>The 50 most recent delivery attempts, newest first.</DialogDescription>
        </DialogHeader>
        {!deliveries || deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell>{EVENT_LABELS[delivery.event]}</TableCell>
                    <TableCell>
                      <Badge variant={delivery.success ? 'default' : 'destructive'}>
                        {delivery.success ? `${delivery.responseStatus ?? ''} OK` : delivery.responseStatus ?? 'No response'}
                      </Badge>
                    </TableCell>
                    <TableCell>{delivery.attempt}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(delivery.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WebhooksSection() {
  const { data: webhooks } = useWebhooks();
  const { data: contentTypes } = useContentTypes();
  const deleteWebhook = useDeleteWebhook();
  const regenerateSecret = useRegenerateWebhookSecret();
  const updateWebhook = useUpdateWebhook();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deliveriesWebhookId, setDeliveriesWebhookId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  function contentTypeName(id: string | null) {
    if (id === null) return 'All content types';
    return contentTypes?.find((ct) => ct.id === id)?.name ?? 'Unknown';
  }

  async function handleRegenerate(id: string) {
    try {
      const updated = await regenerateSecret.mutateAsync(id);
      setRevealedSecret(updated.secret);
      toast.success('Secret regenerated — the old one no longer works');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to regenerate secret');
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await deleteWebhook.mutateAsync(deletingId);
      toast.success('Webhook deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete webhook');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
        <div>
          <CardTitle className="text-lg">Webhooks</CardTitle>
          <CardDescription>Notify external systems when content changes.</CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Add webhook
        </Button>
      </CardHeader>
      <CardContent className="pt-2">
        {!webhooks || webhooks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No webhooks configured yet — add one to get notified when entries are created, updated, or published.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Content type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((webhook) => (
                <TableRow key={webhook.id}>
                  <TableCell className="max-w-64 truncate font-mono text-xs">{webhook.url}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {webhook.events.map((event) => (
                        <Badge key={event} variant="secondary" className="text-xs">
                          {EVENT_LABELS[event]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{contentTypeName(webhook.contentTypeId)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={webhook.enabled}
                      onCheckedChange={(checked) =>
                        void updateWebhook.mutateAsync({ id: webhook.id, enabled: checked }).catch((err) => {
                          toast.error(err instanceof ApiError ? err.message : 'Failed to update webhook');
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDeliveriesWebhookId(webhook.id)}>
                        Deliveries
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingWebhook(webhook)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleRegenerate(webhook.id)}>
                        Regenerate secret
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeletingId(webhook.id)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <WebhookFormDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setRevealedSecret} />
      {editingWebhook ? (
        <WebhookFormDialog
          webhook={editingWebhook}
          open={editingWebhook !== null}
          onOpenChange={(open) => !open && setEditingWebhook(null)}
        />
      ) : null}
      <DeliveriesDialog webhookId={deliveriesWebhookId} onOpenChange={(open) => !open && setDeliveriesWebhookId(null)} />
      <SecretRevealDialog secret={revealedSecret} onClose={() => setRevealedSecret(null)} />

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              This also deletes its delivery log. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

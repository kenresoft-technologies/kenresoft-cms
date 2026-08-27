import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function OptionListEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [newOption, setNewOption] = useState('');

  function addOption() {
    const trimmed = newOption.trim();
    if (!trimmed || options.includes(trimmed)) return;
    onChange([...options, trimmed]);
    setNewOption('');
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Options</Label>
      {options.length === 0 ? <p className="text-sm text-muted-foreground">No options yet.</p> : null}
      {options.map((option, index) => (
        <div key={option} className="flex items-center gap-2">
          <span className="flex-1 text-sm">{option}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${option}`}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          placeholder="option value"
          value={newOption}
          onChange={(event) => setNewOption(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addOption();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addOption}>
          Add
        </Button>
      </div>
    </div>
  );
}

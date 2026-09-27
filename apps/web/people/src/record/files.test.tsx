import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { DisplayValue } from './display';
import { FieldFiles, FileInput, type FileInfo } from './files';
import type { RecordField } from './model';

const contract: RecordField = {
  key: 'contract',
  label: 'Signed contract',
  description: null,
  dataType: 'document_ref',
  options: [],
  required: false,
  readOnly: false,
};
const kept: FileInfo = {
  id: '0b0e6a52-7a2b-4a53-9b7d-4a1e6f0f1c11',
  name: 'contract.pdf',
  mediaType: 'application/pdf',
  size: 240_000,
};

describe('file fields', () => {
  it('shows a document as a link to open it, by its name', () => {
    render(
      <FieldFiles.Provider value={{ upload: null, known: new Map([[kept.id, kept]]) }}>
        <DisplayValue field={contract} value={kept.id} />
      </FieldFiles.Provider>,
    );
    expect(screen.getByRole('link', { name: 'contract.pdf' })).toHaveAttribute(
      'href',
      `/people/files/${kept.id}`,
    );
    expect(screen.getByText('234 KB')).toBeInTheDocument();
  });

  it('uploads a chosen document at once, and the field becomes its id', async () => {
    const user = fast();
    const upload = vi.fn(() => Promise.resolve({ ok: true as const, file: kept }));
    const onChange = vi.fn();
    const { container } = render(
      <FieldFiles.Provider value={{ upload, known: new Map() }}>
        <FileInput field={contract} value={null} invalid={false} description="" onChange={onChange} />
      </FieldFiles.Provider>,
    );
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/Signed contract/), file);
    expect(upload).toHaveBeenCalledWith('contract', file);
    expect(onChange).toHaveBeenCalledWith(kept.id);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says where a file is filled in when the screen cannot upload', () => {
    render(<FileInput field={contract} value={null} invalid={false} description="" onChange={vi.fn()} />);
    expect(screen.getByText('Uploaded on the profile.')).toBeInTheDocument();
  });
});

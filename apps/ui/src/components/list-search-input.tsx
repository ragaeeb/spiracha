import { startTransition } from 'react';
import { Input } from '#/components/ui/input';

type ListSearchInputProps = {
    placeholder: string;
    value: string;
    onValueChange: (value: string) => void;
};

export function ListSearchInput({ placeholder, value, onValueChange }: ListSearchInputProps) {
    return (
        <Input
            className="h-10 w-full rounded-full border-[var(--border)] bg-[var(--panel)] px-4 sm:w-[20rem]"
            placeholder={placeholder}
            value={value}
            onChange={(event) => {
                startTransition(() => {
                    onValueChange(event.target.value);
                });
            }}
        />
    );
}

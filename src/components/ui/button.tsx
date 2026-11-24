import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ButtonHTMLAttributes } from 'react'

export function cn(...values: ClassValue[]) { return twMerge(clsx(values)) }
const buttonVariants = cva('btn', {
  variants: { variant: { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost' } },
  defaultVariants: { variant: 'primary' },
})
export function Button({ asChild = false, variant, className, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonVariants({ variant }), className)} {...props} />
}

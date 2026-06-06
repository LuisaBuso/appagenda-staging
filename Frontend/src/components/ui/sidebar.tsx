"use client"

import * as React from "react"
import { createContext, useContext, useState } from "react"
import { cn } from "../../lib/utils"

type SidebarContextType = {
    expanded: boolean
    setExpanded: React.Dispatch<React.SetStateAction<boolean>>
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
    const [expanded, setExpanded] = useState(true)

    return <SidebarContext.Provider value={{ expanded, setExpanded }}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
    const context = useContext(SidebarContext)
    if (!context) {
        throw new Error("useSidebar must be used within a SidebarProvider")
    }
    return context
}

export function Sidebar({ children, className }: { children: React.ReactNode; className?: string }) {
    const { expanded } = useSidebar()

    return (
        <aside
            className={cn(
                "h-screen bg-background border-r transition-all duration-300 overflow-hidden",
                expanded ? "w-64" : "w-16",
                className,
            )}
        >
            <div className="h-full flex flex-col">{children}</div>
        </aside>
    )
}

export function SidebarHeader({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn("px-3 py-2", className)}>{children}</div>
}

export function SidebarContent({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn("flex-1 overflow-auto", className)}>{children}</div>
}

export function SidebarFooter({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn("px-3 py-2 border-t", className)}>{children}</div>
}

export function SidebarTrigger() {
    const { expanded, setExpanded } = useSidebar()

    return (
        <button
            onClick={() => setExpanded(!expanded)}
            className="h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5 text-muted-foreground"
            >
                <path
                    fillRule="evenodd"
                    d={
                        expanded
                            ? "M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z"
                            : "M10.75 2.75a.75.75 0 00-1.5 0v8.5h-8.5a.75.75 0 000 1.5h8.5v8.5a.75.75 0 001.5 0v-8.5h8.5a.75.75 0 000-1.5h-8.5v-8.5z"
                    }
                    clipRule="evenodd"
                />
            </svg>
        </button>
    )
}

export function SidebarMenu({ children, className }: { children: React.ReactNode; className?: string }) {
    return <ul className={cn("space-y-1", className)}>{children}</ul>
}

export function SidebarMenuItem({ children, className }: { children: React.ReactNode; className?: string }) {
    return <li className={cn("px-3", className)}>{children}</li>
}

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode
    className?: string
    isActive?: boolean
    tooltip?: string
    asChild?: boolean
}

export function SidebarMenuButton({
    children,
    className,
    isActive = false,
    tooltip,
    asChild = false,
    ...props
}: SidebarMenuButtonProps) {
    const { expanded } = useSidebar()
    const Comp = asChild ? React.Fragment : "button"
    const childProps = asChild ? {} : props

    return (
        <div className="relative group">
            <Comp
                {...childProps}
                className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm w-full",
                    isActive ? "bg-muted font-medium" : "hover:bg-muted/50",
                    !expanded && "justify-center px-0",
                    className,
                )}
            >
                {asChild ? (
                    children
                ) : (
                    <>
                        {React.Children.map(children, (child) => {
                            if (React.isValidElement(child) && typeof child.type !== "string") {
                                return child
                            }
                            return expanded ? child : null
                        })}
                    </>
                )}
            </Comp>
            {!expanded && tooltip && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded bg-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    {tooltip}
                </div>
            )}
        </div>
    )
}

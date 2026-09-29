"use client"

import Link from "@/components/site-link"
import { usePathname } from "next/navigation"
import { useProcessingActive } from "@/components/site-link"
import {
  Bell,
  ChevronDown,
  GalleryVerticalEnd,
  Home,
  Layers3,
  UploadCloud,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const navigation = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/styles", label: "Банк стилей", icon: Layers3 },
  { href: "/uploads", label: "Загрузки", icon: UploadCloud, badge: "2" },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const processing = useProcessingActive()

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r-0 bg-[#f4f6f8]">
        <SidebarHeader className="px-3 pb-5 pt-4">
          <div className="flex h-11 items-center gap-3 px-1 group-data-[collapsible=icon]:justify-center">
            <div className="relative flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#1469ff] text-white shadow-[0_7px_18px_rgba(20,105,255,0.2)]">
              <GalleryVerticalEnd className="size-[17px]" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-[15px] font-semibold leading-none tracking-[-0.02em]">
                Банк стилей
              </p>
              <p className="mt-1.5 text-[11px] leading-none text-[#7f8792]">
                Curator
              </p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="px-3">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {navigation.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href)
                  const Icon = item.icon

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className="h-10 rounded-[10px] px-3 text-[14px] text-[#5c6470] data-[active=true]:bg-white data-[active=true]:text-[#15181d] data-[active=true]:shadow-[0_1px_3px_rgba(22,31,48,0.08)] hover:bg-white/75"
                      >
                        <Link href={item.href}>
                          <Icon className="size-[17px]" strokeWidth={1.8} />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.badge ? (
                        <SidebarMenuBadge className="right-2 top-2.5 h-5 min-w-5 rounded-full bg-[#e9eef8] text-[11px] text-[#4a5b73]">
                          {item.badge}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-3">
          <div className="rounded-[12px] border border-black/[0.05] bg-white/60 p-3 group-data-[collapsible=icon]:hidden">
            <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-[#6e7681]">
              <span>Хранилище</span>
              <span>18%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#dfe4ea]">
              <div className="h-full w-[18%] rounded-full bg-[#1469ff]" />
            </div>
            <p className="mt-2 text-[11px] text-[#9299a2]">9,1 из 50 ГБ</p>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#fafbfc]">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-black/[0.06] bg-white/88 px-5 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="mr-1 text-[#67707d]" />
            <span className="hidden text-[13px] text-[#8b929c] sm:block">
              Presentation intelligence
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Уведомления"
              className="relative size-9 rounded-full text-[#5e6671] hover:bg-[#f0f3f7]"
            >
              <Bell className="size-[17px]" />
              <span className="absolute right-[8px] top-[7px] size-1.5 rounded-full bg-[#1469ff] ring-2 ring-white" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-10 gap-2 rounded-full pl-1.5 pr-2 text-[#313741] hover:bg-[#f0f3f7]"
                >
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-[#e9eef8] text-[11px] font-semibold text-[#28456f]">
                      АК
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-[13px] font-medium md:inline">Анна</span>
                  <ChevronDown className="size-3.5 text-[#89919b]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Анна Куратор</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Профиль</DropdownMenuItem>
                <DropdownMenuItem>Журнал действий</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Выйти</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {processing ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d6e3fc] bg-[#edf4ff] px-5 py-3 text-xs text-[#345b91] lg:px-8">
          <span>Идёт разбор презентации. Оставьте эту вкладку открытой; переходы откроются в новой вкладке.</span>
          <Link href="/uploads" className="font-medium underline underline-offset-2">Показать обработку</Link>
        </div> : null}
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

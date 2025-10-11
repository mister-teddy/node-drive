import React from 'react';
import { Home, ChevronRight } from 'lucide-react';

interface BreadcrumbItem {
  name: string;
  href: string;
  isLast: boolean;
}

interface BreadcrumbProps {
  href: string;
  uriPrefix: string;
}

export function Breadcrumb({ href, uriPrefix }: BreadcrumbProps) {
  const items: BreadcrumbItem[] = [];

  let parts: string[] = [];
  if (href === "/") {
    parts = [""];
  } else {
    parts = href.split("/");
  }

  const len = parts.length;
  let path = uriPrefix;

  for (let i = 0; i < len; i++) {
    const name = parts[i];
    if (i > 0) {
      if (!path.endsWith("/")) {
        path += "/";
      }
      path += encodeURIComponent(name);
    }

    items.push({
      name: name || "Home",
      href: path,
      isLast: i === len - 1,
    });
  }

  return (
    <nav className="flex items-center gap-2 px-6 py-4 text-sm">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index === 0 ? (
            <a
              href={item.href}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Root"
            >
              <Home className="h-4 w-4" />
            </a>
          ) : (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              {item.isLast ? (
                <span className="font-medium text-foreground">
                  {item.name}
                </span>
              ) : (
                <a
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {item.name}
                </a>
              )}
            </>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

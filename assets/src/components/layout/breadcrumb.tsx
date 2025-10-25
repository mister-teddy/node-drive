import { Breadcrumb as AntBreadcrumb } from "antd";
import { HomeOutlined, SearchOutlined } from "@ant-design/icons";
import { Link, useLocation } from "react-router-dom";

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
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const searchQuery = searchParams.get("q");

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

  const breadcrumbItems = items.map((item, index) => {
    if (index === 0) {
      return {
        title: (
          <Link to={item.href} title="Root">
            <HomeOutlined />
          </Link>
        ),
      };
    }

    if (item.isLast) {
      return {
        title: <span className="font-medium">{item.name}</span>,
      };
    }

    return {
      title: <Link to={item.href}>{item.name}</Link>,
    };
  });

  // If we're in search mode, append search results indicator
  if (searchQuery) {
    breadcrumbItems.push({
      title: (
        <span className="flex items-center gap-2">
          <SearchOutlined />
          <span className="font-medium">
            Search results for: "{searchQuery}"
          </span>
        </span>
      ),
    });
  }

  return (
    <div className="py-4 px-6">
      <AntBreadcrumb items={breadcrumbItems} />
    </div>
  );
}

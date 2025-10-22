import { Breadcrumb as AntBreadcrumb } from "antd";
import { HomeOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

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
        title: <span style={{ fontWeight: 500 }}>{item.name}</span>,
      };
    }

    return {
      title: <Link to={item.href}>{item.name}</Link>,
    };
  });

  return (
    <div style={{ padding: "16px 24px" }}>
      <AntBreadcrumb items={breadcrumbItems} />
    </div>
  );
}

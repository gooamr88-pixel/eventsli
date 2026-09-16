import Content from './Content';

export const metadata = {
  title: 'Homepage content',
  // Every /admin route is behind a session, so a crawler gets a redirect rather
  // than a page — but `lib/siteRoutes.js` also lists /admin as a private prefix
  // and robots.txt says so. This is the third layer, and it is the one that
  // travels with the page if the other two are ever edited.
  robots: { index: false, follow: false },
};

export default function ContentPage() {
  return <Content />;
}

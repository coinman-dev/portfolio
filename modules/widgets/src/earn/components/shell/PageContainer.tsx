import React from 'react';

export const PageContainer: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={className ? `y-container ${className}` : 'y-container'}>{children}</div>;
